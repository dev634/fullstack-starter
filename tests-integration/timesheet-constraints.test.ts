import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

/**
 * Pointage — what the DATABASE refuses, proven against a real Postgres.
 *
 * Migrations 20260927100000_timesheet_worker_login and 20260927110000_timesheets
 * put most of the timesheet rules in CHECKs, composite FKs and two PL/pgSQL
 * triggers. Prisma cannot express any of them and `migrate diff` cannot see
 * them: this file is the only executable proof that they exist and say what
 * the migrations' comments claim. One `it` per case, so a red names the rule.
 *
 * ISOLATION — every case runs in its OWN interactive transaction that is
 * always rolled back (rolledBack below). Not the afterEach-delete idiom of
 * reserve-numbering.test.ts: the rules under test make the rows they create
 * undeletable in any simple order (a signed line is RESTRICTed by its
 * signature, a validated line's signature cannot be removed, a fiche with
 * hours cannot be deleted), and a rollback leaves nothing behind even when an
 * assertion fails half-way. The statement under test runs inside a SAVEPOINT
 * so the transaction stays usable whatever it raises. Side effect that a
 * rollback does not undo: SERIAL sequences advance (ids are skipped, nothing
 * is stored). Fixture e-mails use TEST_DOMAIN, so a leak would be findable.
 *
 * ON A DATABASE WITHOUT THESE MIGRATIONS this file is RED, on purpose, with
 * one explicit message (beforeAll). Not a skip: CI applies every migration
 * before `npm run test:integration` (.github/workflows/ci.yml), so a missing
 * one there means a failed or reordered deploy step, and a skipped suite exits
 * 0 — it would certify constraints it never inspected.
 *
 * HOW ERRORS ARE READ — measured with this repo's client (PrismaClient +
 * @prisma/adapter-pg): a failing $executeRaw throws P2010 whose
 * meta.driverAdapterError.cause carries the SQLSTATE (`originalCode`) and the
 * server message (`originalMessage`). That path is undocumented — the same
 * adapter structure docs/CONVENTIONS.md flags for P2002 — so outcomeOf falls
 * back on the documented top-level message ("Code: `…`. Message: `…`") and
 * fails loudly if neither is there. The constraint name is asserted through
 * the message: the adapter drops the CONSTRAINT option of a trigger's RAISE,
 * so trigger cases assert on the trigger's own message text instead.
 */

const MIGRATIONS = ["20260927100000_timesheet_worker_login", "20260927110000_timesheets"];
const TEST_DOMAIN = "@timesheet-constraints-test.local";

type Tx = Prisma.TransactionClient;
type Outcome = { ok: true } | { ok: false; code: string; message: string };
type Fixture = { clientId: number; projectA: number; projectB: number; interim1: number; interim2: number };

const ROLLBACK = new Error("timesheet-constraints: rolled back on purpose");

/** Runs `body` in a transaction that is ALWAYS rolled back; returns its outcome. */
async function rolledBack(body: (tx: Tx) => Promise<Outcome>): Promise<Outcome> {
  const box: Outcome[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      box.push(await body(tx));
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  const [outcome] = box;
  if (outcome === undefined) throw new Error("rolledBack: the body produced no outcome");
  return outcome;
}

/** One step down an unknown object, without a cast. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const found: unknown = Reflect.get(value, key);
  return found;
}

/** The SQLSTATE and server message of a failed raw statement. */
function outcomeOf(error: unknown): Outcome {
  const cause = field(field(field(error, "meta"), "driverAdapterError"), "cause");
  const code = field(cause, "originalCode");
  const message = field(cause, "originalMessage");
  if (typeof code === "string" && typeof message === "string") {
    return { ok: false, code, message };
  }
  const text = error instanceof Error ? error.message : String(error);
  const match = /Code: `([0-9A-Z]{5})`\. Message: `([\s\S]*)`/.exec(text);
  if (match) return { ok: false, code: match[1], message: match[2] };
  return { ok: false, code: "unreadable", message: text };
}

/** Runs the statement under test inside a SAVEPOINT and reports what it did. */
async function attempt(tx: Tx, statement: () => Promise<unknown>): Promise<Outcome> {
  await tx.$executeRaw`SAVEPOINT timesheet_case`;
  try {
    await statement();
    await tx.$executeRaw`RELEASE SAVEPOINT timesheet_case`;
    return { ok: true };
  } catch (error) {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT timesheet_case`;
    return outcomeOf(error);
  }
}

function refused(code: string, fragment: string) {
  return { ok: false, code, message: expect.stringContaining(fragment) };
}

const CHECK = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";

async function makeFixture(tx: Tx): Promise<Fixture> {
  const client = await tx.client.create({
    data: {
      companyName: "Sonde pointage",
      address: "1 rue de la Sonde",
      zipCode: "00000",
      city: "Testville",
      country: "Testland",
      email: `client-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_DOMAIN}`,
    },
  });
  const projectA = await tx.project.create({ data: { clientId: client.id, name: "Sonde A" } });
  const projectB = await tx.project.create({ data: { clientId: client.id, name: "Sonde B" } });
  const interim1 = await tx.interim.create({ data: { projectId: projectA.id, name: "Intérimaire sonde" } });
  const interim2 = await tx.interim.create({ data: { projectId: projectA.id, name: "Intérimaire sonde 2" } });
  return { clientId: client.id, projectA: projectA.id, projectB: projectB.id, interim1: interim1.id, interim2: interim2.id };
}

/**
 * The reference line of the original probe: interim1 on project A, arrival
 * 00:30 Paris on 29 March 2026 (23:30 UTC the day before), departure 09:30
 * Paris, 30 minutes of break. Instants are UTC, as stored.
 */
async function insertReferenceLine(tx: Tx, f: Fixture): Promise<number> {
  const rows = await tx.$queryRaw<{ id: number }[]>`
    INSERT INTO "TimesheetEntry" ("projectId", "interimId", "workDate", "startAt", "endAt", "breakMinutes", "updatedAt")
    VALUES (${f.projectA}, ${f.interim1}, '2026-03-29'::date, '2026-03-28 23:30'::timestamp, '2026-03-29 07:30'::timestamp, 30, now())
    RETURNING "id"`;
  return rows[0].id;
}

const TINY_PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

/** A buffer of exactly `size` bytes that starts with the PNG signature. */
function pngOfSize(size: number): Buffer {
  return Buffer.concat([PNG_SIGNATURE, Buffer.alloc(size - PNG_SIGNATURE.length)]);
}

/** Signs the reference line with the hours and break it was shown. */
async function signReferenceLine(tx: Tx, entryId: number): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "TimesheetSignature" ("entryId", "image", "signedStartAt", "signedEndAt", "signedBreakMinutes", "signerName")
    VALUES (${entryId}, ${TINY_PNG}, '2026-03-28 23:30'::timestamp, '2026-03-29 07:30'::timestamp, 30, 'Intérimaire sonde')`;
}

async function validate(tx: Tx, entryId: number): Promise<void> {
  await tx.$executeRaw`
    UPDATE "TimesheetEntry" SET "validatedAt" = now(), "validatorName" = 'Chef' WHERE "id" = ${entryId}`;
}

beforeAll(async () => {
  const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL AND migration_name IN (${MIGRATIONS[0]}, ${MIGRATIONS[1]})`;
  const applied = new Set(rows.map((r) => r.migration_name));
  const missing = MIGRATIONS.filter((name) => !applied.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Pointage : migration(s) non appliquée(s) sur cette base — ${missing.join(", ")}. ` +
        `Lancer \`npx prisma migrate deploy\` (la CI le fait avant ce test). ` +
        `Ce fichier ne saute pas : vert sur une base non migrée, il certifierait des contraintes qu'il n'a pas vues.`
    );
  }
});

describe("pointage — livraison 2 : e-mail des fiches et désactivation", () => {
  it("L2a : une adresse en majuscules est refusée (forme canonique)", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      return attempt(tx, () => tx.$executeRaw`UPDATE "Interim" SET "email" = 'Jean@Agence.fr' WHERE "id" = ${f.interim1}`);
    });
    expect(outcome).toEqual(refused(CHECK, "Interim_email_check"));
  });

  it("L2b : la même adresse sur deux fiches d'un même chantier est refusée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      await tx.$executeRaw`UPDATE "Interim" SET "email" = 'jean@agence.fr' WHERE "id" = ${f.interim1}`;
      return attempt(tx, () => tx.$executeRaw`UPDATE "Interim" SET "email" = 'jean@agence.fr' WHERE "id" = ${f.interim2}`);
    });
    expect(outcome).toEqual(refused(UNIQUE, "Interim_email_projectId_key"));
  });

  it("L2c : User.deactivatedAt existe, nullable, sans défaut", async () => {
    const columns = await prisma.$queryRaw<{ data_type: string; is_nullable: string; column_default: string | null }[]>`
      SELECT data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'User' AND column_name = 'deactivatedAt'`;
    expect(columns).toEqual([{ data_type: "timestamp without time zone", is_nullable: "YES", column_default: null }]);
  });
});

describe("pointage — lignes", () => {
  it("01 : une ligne valide est acceptée (arrivée 00:30 Paris classée au 29)", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      return attempt(tx, () => insertReferenceLine(tx, f));
    });
    expect(outcome).toEqual({ ok: true });
  });

  it("02 : le jour UTC au lieu du jour de Paris est refusé", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetEntry" ("projectId", "interimId", "workDate", "startAt", "updatedAt")
          VALUES (${f.projectA}, ${f.interim2}, '2026-03-28'::date, '2026-03-28 23:30'::timestamp, now())`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "TimesheetEntry_workDate_check"));
  });

  it("03 : une ligne sans personne est refusée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetEntry" ("projectId", "workDate", "startAt", "updatedAt")
          VALUES (${f.projectA}, '2026-03-30'::date, '2026-03-30 06:00'::timestamp, now())`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "TimesheetEntry_one_person_check"));
  });

  it("04 : la fiche d'un chantier A pointée sur le chantier B est refusée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetEntry" ("projectId", "interimId", "workDate", "startAt", "updatedAt")
          VALUES (${f.projectB}, ${f.interim1}, '2026-03-30'::date, '2026-03-30 06:00'::timestamp, now())`
      );
    });
    expect(outcome).toEqual(refused(FOREIGN_KEY, "TimesheetEntry_interim_fkey"));
  });

  it("05 : une seconde ligne pour la même personne le même jour est refusée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      await insertReferenceLine(tx, f);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetEntry" ("projectId", "interimId", "workDate", "startAt", "updatedAt")
          VALUES (${f.projectA}, ${f.interim1}, '2026-03-29'::date, '2026-03-29 12:00'::timestamp, now())`
      );
    });
    expect(outcome).toEqual(refused(UNIQUE, "TimesheetEntry_interimId_workDate_key"));
  });

  it("06 : un poste de 24 h 01 est refusé", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetEntry" ("projectId", "interimId", "workDate", "startAt", "endAt", "breakMinutes", "updatedAt")
          VALUES (${f.projectA}, ${f.interim2}, '2026-03-31'::date, '2026-03-31 05:00'::timestamp, '2026-04-01 05:01'::timestamp, 30, now())`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "TimesheetEntry_hours_check"));
  });

  it("07 : une ligne ne peut pas naître validée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetEntry" ("projectId", "interimId", "workDate", "startAt", "validatedAt", "validatorName", "updatedAt")
          VALUES (${f.projectA}, ${f.interim2}, '2026-04-02'::date, '2026-04-02 05:00'::timestamp, now(), 'Chef', now())`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "cannot be created already validated"));
  });
});

describe("pointage — pause déduite (amendement A)", () => {
  it("B1 : un départ sans pause déclarée est refusé", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetEntry" ("projectId", "interimId", "workDate", "startAt", "endAt", "updatedAt")
          VALUES (${f.projectA}, ${f.interim2}, '2026-05-04'::date, '2026-05-04 05:00'::timestamp, '2026-05-04 14:00'::timestamp, now())`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "TimesheetEntry_break_check"));
  });

  it("B2 : une pause sans départ est refusée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetEntry" ("projectId", "interimId", "workDate", "startAt", "breakMinutes", "updatedAt")
          VALUES (${f.projectA}, ${f.interim2}, '2026-05-05'::date, '2026-05-05 05:00'::timestamp, 30, now())`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "TimesheetEntry_break_check"));
  });

  it("B3 : une pause de 0 minute, déclarée, est acceptée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetEntry" ("projectId", "interimId", "workDate", "startAt", "endAt", "breakMinutes", "updatedAt")
          VALUES (${f.projectA}, ${f.interim2}, '2026-05-06'::date, '2026-05-06 05:00'::timestamp, '2026-05-06 14:00'::timestamp, 0, now())`
      );
    });
    expect(outcome).toEqual({ ok: true });
  });

  it("B4 : une pause aussi longue que la journée est refusée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetEntry" ("projectId", "interimId", "workDate", "startAt", "endAt", "breakMinutes", "updatedAt")
          VALUES (${f.projectA}, ${f.interim2}, '2026-05-06'::date, '2026-05-06 05:00'::timestamp, '2026-05-06 14:00'::timestamp, 540, now())`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "TimesheetEntry_break_check"));
  });

  it("B5 : une pause négative est refusée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetEntry" ("projectId", "interimId", "workDate", "startAt", "endAt", "breakMinutes", "updatedAt")
          VALUES (${f.projectA}, ${f.interim2}, '2026-05-06'::date, '2026-05-06 05:00'::timestamp, '2026-05-06 14:00'::timestamp, -5, now())`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "TimesheetEntry_break_check"));
  });

  // 22:00 -> 06:00 Paris on 29 March 2026 = 21:00Z -> 04:00Z = 7 real hours.
  it("B6 : 420 minutes de pause sur une nuit de 7 h réelles (passage à l'heure d'été) sont refusées", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetEntry" ("projectId", "interimId", "workDate", "startAt", "endAt", "breakMinutes", "updatedAt")
          VALUES (${f.projectA}, ${f.interim2}, '2026-03-28'::date, '2026-03-28 21:00'::timestamp, '2026-03-29 04:00'::timestamp, 420, now())`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "TimesheetEntry_break_check"));
  });

  it("B7 : 419 minutes de pause sur la même nuit sont acceptées", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetEntry" ("projectId", "interimId", "workDate", "startAt", "endAt", "breakMinutes", "updatedAt")
          VALUES (${f.projectA}, ${f.interim2}, '2026-03-28'::date, '2026-03-28 21:00'::timestamp, '2026-03-29 04:00'::timestamp, 419, now())`
      );
    });
    expect(outcome).toEqual({ ok: true });
  });

  it("B8 : une signature portant une autre pause que la ligne est refusée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetSignature" ("entryId", "image", "signedStartAt", "signedEndAt", "signedBreakMinutes", "signerName")
          VALUES (${entryId}, ${TINY_PNG}, '2026-03-28 23:30'::timestamp, '2026-03-29 07:30'::timestamp, 0, 'Intérimaire sonde')`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "differ from what was shown to the signer"));
  });

  it("B9 : la pause d'une ligne signée ne change plus", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      await signReferenceLine(tx, entryId);
      return attempt(tx, () => tx.$executeRaw`UPDATE "TimesheetEntry" SET "breakMinutes" = 45 WHERE "id" = ${entryId}`);
    });
    expect(outcome).toEqual(refused(CHECK, "can no longer change"));
  });
});

describe("pointage — signature, plafond d'image (amendement B), validation, suppression", () => {
  it("08 : une ligne non signée ne peut pas être validée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      return attempt(tx, () => validate(tx, entryId));
    });
    expect(outcome).toEqual(refused(CHECK, "an unsigned line cannot be validated"));
  });

  it("09 : une signature portant d'autres heures que la ligne est refusée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetSignature" ("entryId", "image", "signedStartAt", "signedEndAt", "signedBreakMinutes", "signerName")
          VALUES (${entryId}, ${TINY_PNG}, '2026-03-28 23:30'::timestamp, '2026-03-29 08:30'::timestamp, 30, 'Intérimaire sonde')`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "differ from what was shown to the signer"));
  });

  it("10 : une image qui n'est pas un PNG est refusée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      const gif = Buffer.from("474946383961", "hex");
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetSignature" ("entryId", "image", "signedStartAt", "signedEndAt", "signedBreakMinutes", "signerName")
          VALUES (${entryId}, ${gif}, '2026-03-28 23:30'::timestamp, '2026-03-29 07:30'::timestamp, 30, 'Intérimaire sonde')`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "TimesheetSignature_image_check"));
  });

  it("I1 : un PNG de 53 249 octets est refusé", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      const image = pngOfSize(53249);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetSignature" ("entryId", "image", "signedStartAt", "signedEndAt", "signedBreakMinutes", "signerName")
          VALUES (${entryId}, ${image}, '2026-03-28 23:30'::timestamp, '2026-03-29 07:30'::timestamp, 30, 'Intérimaire sonde')`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "TimesheetSignature_image_check"));
  });

  it("I2 : un PNG de 53 248 octets est accepté", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      const image = pngOfSize(53248);
      return attempt(
        tx,
        () => tx.$executeRaw`
          INSERT INTO "TimesheetSignature" ("entryId", "image", "signedStartAt", "signedEndAt", "signedBreakMinutes", "signerName")
          VALUES (${entryId}, ${image}, '2026-03-28 23:30'::timestamp, '2026-03-29 07:30'::timestamp, 30, 'Intérimaire sonde')`
      );
    });
    expect(outcome).toEqual({ ok: true });
  });

  it("11 : la signature des heures et de la pause affichées est acceptée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      return attempt(tx, () => signReferenceLine(tx, entryId));
    });
    expect(outcome).toEqual({ ok: true });
  });

  it("12 : les heures d'une ligne signée ne changent plus", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      await signReferenceLine(tx, entryId);
      return attempt(tx, () => tx.$executeRaw`UPDATE "TimesheetEntry" SET "endAt" = '2026-03-29 09:30'::timestamp WHERE "id" = ${entryId}`);
    });
    expect(outcome).toEqual(refused(CHECK, "can no longer change"));
  });

  it("13 : une ligne signée ne peut pas être supprimée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      await signReferenceLine(tx, entryId);
      return attempt(tx, () => tx.$executeRaw`DELETE FROM "TimesheetEntry" WHERE "id" = ${entryId}`);
    });
    expect(outcome).toEqual(refused(FOREIGN_KEY, "TimesheetSignature_entryId_fkey"));
  });

  it("14 : une ligne signée peut être validée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      await signReferenceLine(tx, entryId);
      return attempt(tx, () => validate(tx, entryId));
    });
    expect(outcome).toEqual({ ok: true });
  });

  it("15 : le tampon de validation ne se réécrit pas", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      await signReferenceLine(tx, entryId);
      await validate(tx, entryId);
      return attempt(
        tx,
        () => tx.$executeRaw`UPDATE "TimesheetEntry" SET "validatedAt" = now() + interval '1 second' WHERE "id" = ${entryId}`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "a validation stamp is never rewritten"));
  });

  it("16 : la signature d'une ligne validée ne peut pas être retirée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      await signReferenceLine(tx, entryId);
      await validate(tx, entryId);
      return attempt(tx, () => tx.$executeRaw`DELETE FROM "TimesheetSignature" WHERE "entryId" = ${entryId}`);
    });
    expect(outcome).toEqual(refused(CHECK, "its signature cannot be removed"));
  });

  it("17 : une signature ne se modifie jamais", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      await signReferenceLine(tx, entryId);
      await validate(tx, entryId);
      return attempt(
        tx,
        () => tx.$executeRaw`UPDATE "TimesheetSignature" SET "signedBreakMinutes" = 0 WHERE "entryId" = ${entryId}`
      );
    });
    expect(outcome).toEqual(refused(CHECK, "signature is never modified"));
  });

  it("18 : une fiche qui porte des heures ne peut pas être supprimée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      await signReferenceLine(tx, entryId);
      return attempt(tx, () => tx.$executeRaw`DELETE FROM "Interim" WHERE "id" = ${f.interim1}`);
    });
    expect(outcome).toEqual(refused(FOREIGN_KEY, "TimesheetEntry_interim_fkey"));
  });

  it("19 : supprimer l'entreprise cliente ne fait pas disparaître les heures par cascade", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      await signReferenceLine(tx, entryId);
      return attempt(tx, () => tx.$executeRaw`DELETE FROM "Client" WHERE "id" = ${f.clientId}`);
    });
    // Which RESTRICT fires first (the project's or the fiche's) depends on the
    // cascade order; either way the refusal comes from a TimesheetEntry FK.
    expect(outcome).toEqual(refused(FOREIGN_KEY, 'on table "TimesheetEntry"'));
  });

  it("20 : la dévalidation est permise par la base", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      await signReferenceLine(tx, entryId);
      await validate(tx, entryId);
      return attempt(
        tx,
        () => tx.$executeRaw`
          UPDATE "TimesheetEntry" SET "validatedAt" = NULL, "validatorName" = NULL, "validatedById" = NULL
          WHERE "id" = ${entryId}`
      );
    });
    expect(outcome).toEqual({ ok: true });
  });

  it("21 : la signature d'une ligne dévalidée peut être retirée", async () => {
    const outcome = await rolledBack(async (tx) => {
      const f = await makeFixture(tx);
      const entryId = await insertReferenceLine(tx, f);
      await signReferenceLine(tx, entryId);
      await validate(tx, entryId);
      await tx.$executeRaw`
        UPDATE "TimesheetEntry" SET "validatedAt" = NULL, "validatorName" = NULL, "validatedById" = NULL
        WHERE "id" = ${entryId}`;
      return attempt(tx, () => tx.$executeRaw`DELETE FROM "TimesheetSignature" WHERE "entryId" = ${entryId}`);
    });
    expect(outcome).toEqual({ ok: true });
  });
});
