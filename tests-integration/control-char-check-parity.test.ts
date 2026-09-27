import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createEquipmentSchema } from "@/schemas/equipment";
import { createMaterialCategorySchema } from "@/schemas/materialCategory";
import { updateReserveStatusStyleSchema } from "@/schemas/reserve";

/**
 * The application-side schemas refuse exactly what the database's
 * `!~ '[[:cntrl:]]'` CHECKs refuse — proven against a real Postgres, on both
 * sides, rather than by reading the two texts and judging them alike.
 *
 * Why a live test and not a unit test: the two classes cannot be compared in
 * JS. Postgres's `[[:cntrl:]]` depends on the database's ctype — under UTF-8
 * it also covers C1 (U+0080–U+009F, what a `€` pasted from a mis-decoded
 * Windows-1252 document becomes) — while the obvious JS class
 * `[\x00-\x1f\x7f]` stops at ASCII. Only asking the real engine settles it.
 *
 * The defect this closes, paid three times: a schema narrower than its CHECK
 * lets a legitimate entry through the door and kills it on the net, and the
 * user gets `t.errors.serverError` ("Erreur serveur") instead of a field
 * error naming the problem. schemas/materialCategory.ts had no class at all
 * under a comment claiming parity (#228); the shared CONTROL_CHAR itself
 * stopped at \x7f until a probe widened it; schemas/equipment.ts shipped its
 * own ASCII copy (#230).
 *
 * Discovery: the list of constrained columns is READ FROM pg_constraint, not
 * hand-maintained here — the database is the table that defines this domain.
 * A new `[[:cntrl:]]` CHECK added tomorrow without an entry in GUARDED below
 * turns this red, which is the point: the CHECK and its door ship together.
 */

/** A sample the database refuses is expected to be refused by the schema too. */
const SAMPLES = [
  { label: "nom ordinaire", value: "Perceuse Hilti" },
  { label: "accents, tiret cadratin, euro", value: "Perceuse à béton — 20 €" },
  { label: "C0 tabulation", value: "Perceuse\tHilti" },
  { label: "C0 saut de ligne", value: "Perceuse\nHilti" },
  { label: "DEL U+007F", value: "Perceuse" },
  { label: "C1 U+0080 (€ mal décodé)", value: "Prix" },
  { label: "C1 U+0085 (NEL)", value: "PerceuseHilti" },
  { label: "C1 U+009F", value: "Perceuse" },
  { label: "séparateur de ligne U+2028", value: "Perceuse Hilti" },
] as const;

/**
 * Each constrained column, with the schema that guards it. `accepts` runs the
 * REAL schema the action parses with, never a copy of its rules.
 */
const GUARDED: { constraint: string; column: string; accepts: (value: string) => boolean }[] = [
  {
    constraint: "Equipment_name_check",
    column: "Equipment.name",
    accepts: (value) => createEquipmentSchema.safeParse({ name: value, reference: "" }).success,
  },
  {
    constraint: "Equipment_reference_check",
    column: "Equipment.reference",
    accepts: (value) => createEquipmentSchema.safeParse({ name: "Perceuse", reference: value }).success,
  },
  {
    constraint: "ProjectMaterialCategory_name_check",
    column: "ProjectMaterialCategory.name",
    accepts: (value) =>
      createMaterialCategorySchema.safeParse({ projectId: "1", clientId: "1", name: value }).success,
  },
  {
    constraint: "Project_reserveOpenLabel_check",
    column: "Project.reserveOpenLabel",
    accepts: (value) =>
      updateReserveStatusStyleSchema.safeParse({
        projectId: "1",
        openLabel: value,
        openColor: "#ff8800",
        resolvedLabel: "Terminée",
        resolvedColor: "#059669",
      }).success,
  },
  {
    constraint: "Project_reserveResolvedLabel_check",
    column: "Project.reserveResolvedLabel",
    accepts: (value) =>
      updateReserveStatusStyleSchema.safeParse({
        projectId: "1",
        openLabel: "À traiter",
        openColor: "#ff8800",
        resolvedLabel: value,
        resolvedColor: "#059669",
      }).success,
  },
];

/** Postgres's own verdict on the control-character clause, for one value. */
async function databaseAcceptsControlChars(value: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT (${value} !~ '[[:cntrl:]]') AS ok`;
  return rows[0].ok;
}

describe("les schémas refusent exactement ce que les CHECK [[:cntrl:]] refusent", () => {
  it("recense les CHECK en base et les retrouve tous dans la table GUARDED", async () => {
    const rows = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c' AND pg_get_constraintdef(oid) LIKE '%cntrl%'
      ORDER BY conname
    `;
    const inDatabase = rows.map((r) => r.conname);
    const wired = GUARDED.map((g) => g.constraint);
    const unwired = inDatabase.filter((c) => !wired.includes(c));
    expect(
      unwired,
      unwired.length
        ? `Ces CHECK rejettent les caractères de contrôle mais aucun schéma n'est déclaré pour eux ici :\n` +
          unwired.map((c) => `  - ${c}`).join("\n") +
          `\n\nAjoute l'entrée dans GUARDED avec le schéma qui garde la colonne : une contrainte ` +
          `sans porte applicative rend une saisie légitime en « erreur serveur » générique.`
        : undefined
    ).toEqual([]);
    expect(inDatabase.length, "aucun CHECK [[:cntrl:]] trouvé — la migration a-t-elle été appliquée ?").toBeGreaterThan(
      0
    );
  });

  it.each(GUARDED)("$column : le schéma refuse tout ce que la base refuse", async ({ column, accepts }) => {
    const divergences: string[] = [];
    for (const { label, value } of SAMPLES) {
      const database = await databaseAcceptsControlChars(value);
      const schema = accepts(value);
      // Le schéma peut être PLUS strict que la base (trim, longueur, format) ;
      // jamais plus laxiste — c'est ce sens-là qui produit l'erreur générique.
      if (!database && schema) divergences.push(`${label} : la base refuse, le schéma accepte`);
    }
    expect(
      divergences,
      divergences.length ? `${column} :\n` + divergences.map((d) => `  - ${d}`).join("\n") : undefined
    ).toEqual([]);
  });
});
