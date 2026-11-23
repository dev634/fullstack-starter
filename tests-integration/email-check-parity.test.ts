import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/normalizeEmail";

/**
 * `normalizeEmail` (JS) against the CHECK `User_email_normalized_check`
 * (PostgreSQL), proven on the real database — the sonde the lot 3 auditor played
 * once, frozen. The two engines are not the same function (trim() strips 16
 * code points where btrim strips one; lower() and toLowerCase() part ways on
 * some code points and on the word-final sigma), so the application's output
 * must be shown to pass the net, not assumed to.
 *
 * NO ROW IS CREATED: the CHECK expression is evaluated in a SELECT, over a
 * derived table that exposes the sample as a column named `email`. The text of
 * the expression is read from pg_get_constraintdef — never copied here — so a
 * migration that changes the CHECK changes what this test measures.
 *
 * What it asserts, per sample string `s`:
 *   1. normalizeEmail(s) satisfies the CHECK. (The gate the application writes
 *      through must never meet the net: a 23514 would be an "erreur serveur".)
 *   2. when normalizeEmail(s) !== s, `s` itself VIOLATES the CHECK — except on
 *      the divergent code points below, where the base's behaviour is what it
 *      is and is pinned as such.
 *
 * THE DIVERGENT CODE POINTS (lib/normalizeEmail.ts, migration 20261123100000,
 * step 1): where `toLowerCase()` and Postgres `lower()` do not give the same
 * answer. The migration counts 29; this test measures them, it does not
 * recopy them:
 *   - U+0130 'İ': JS gives 'i' + U+0307, Postgres gives 'i'. The base DOES
 *     refuse a raw 'İ' (lower('İ') <> 'İ'); the normalized form passes.
 *   - the 28 letters U+A7CE, U+A7D2, U+A7D4, U+16EA0..U+16EB8 (Unicode 17):
 *     glibc 2.41 does not know them as capitals, so Postgres leaves them
 *     unchanged. The base therefore ACCEPTS a raw capital of that list (the
 *     residual the migration states: a raw writer can store it); the
 *     application, normalizing first, stores the lowercase form, which passes.
 *     So 29 divergent = 28 + U+0130, and "28" is the count where the CHECK is
 *     blind, not the count of divergences.
 *   - the word-final sigma: 'ΟΔΟΣ' -> JS 'οδος', Postgres 'οδοσ'. The raw
 *     'ΟΔΟΣ' is refused (lower('ΟΔΟΣ') <> 'ΟΔΟΣ'); 'οδος' passes the CHECK.
 * The documented list holds for the engines the migration was probed on
 * (PostgreSQL 16 / glibc 2.41, Node ICU 78.2 / Unicode 17). On other engines
 * (CI runs `postgres:16`, whatever glibc the image carries) the test does not
 * pin a count: for each code point it MEASURES what both sides do and asserts
 * the invariants above of what it measured — a different glibc or ICU moves
 * the measurement, not the verdict.
 */

const TRIM_CHARS: string[] = [
  "\t", "\n", "\v", "\f", "\r", " ", " ", " ",
  " ", " ", " ", " ", " ", " ", " ", " ", " ", " ", " ",
  " ", " ", " ", " ", "　", "﻿",
];

const DOCUMENTED_UNTOUCHED_BY_POSTGRES: number[] = [
  0xa7ce,
  0xa7d2,
  0xa7d4,
  ...Array.from({ length: 0x16eb8 - 0x16ea0 + 1 }, (_, i) => 0x16ea0 + i),
];

const REALISTIC = [
  "Jean.Dupont@Exemple.FR",
  "  marie_curie+test@sub.Domaine.com ",
  "josé@exemple.fr",
  "ÉLODIE@Société.fr",
  "O'Brien@x.ie",
  "\tpaul@x.fr\n",
  "paul@x.fr",
  "PAUL@X.FR",
  "a@b.c",
  "",
];

const hex = (s: string): string => [...s].map((ch) => "U+" + ch.codePointAt(0)!.toString(16)).join(" ");

/** Every character JS lowercases (the domain where lower() and toLowerCase() can disagree). */
function charactersJsLowers(): string[] {
  const out: string[] = [];
  for (let cp = 1; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    if (ch.toLowerCase() !== ch) out.push(ch);
  }
  return out;
}

const ASCII_PRINTABLE = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i));
const JS_LOWERED = charactersJsLowers();

/** The shapes each single character is tried in: alone, between letters, at either edge, at both. */
function shapesOf(c: string): string[] {
  return [c, `a${c}b@x.fr`, `${c}a@x.fr`, `a@x.fr${c}`, `${c}a@x.fr${c}`];
}

type Verdict = { ok: boolean; pgLowerLeavesItAlone: boolean };

let checkExpression = "";

/** Postgres's verdict on the CHECK, and on `lower(s) = s`, for each string, one round trip per chunk. */
async function verdicts(values: readonly string[]): Promise<Map<string, Verdict>> {
  const out = new Map<string, Verdict>();
  const unique = [...new Set(values)];
  for (let i = 0; i < unique.length; i += 2000) {
    const chunk = unique.slice(i, i + 2000);
    const rows = await prisma.$queryRawUnsafe<{ email: string; ok: boolean; same: boolean }[]>(
      `SELECT u.email AS email, (${checkExpression}) AS ok, (lower(u.email) = u.email) AS same
       FROM unnest($1::text[]) AS u(email)`,
      chunk
    );
    for (const r of rows) out.set(r.email, { ok: r.ok, pgLowerLeavesItAlone: r.same });
  }
  return out;
}

beforeAll(async () => {
  const rows = await prisma.$queryRaw<{ def: string }[]>`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conname = 'User_email_normalized_check' AND conrelid = '"User"'::regclass
  `;
  expect(rows, "User_email_normalized_check absent — la migration 20261123100000 est-elle appliquée ?").toHaveLength(1);
  const match = /^CHECK \(([\s\S]*)\)$/.exec(rows[0]!.def);
  expect(match, `forme inattendue de pg_get_constraintdef : ${rows[0]!.def}`).not.toBeNull();
  checkExpression = match![1]!;
});

describe("normalizeEmail satisfait User_email_normalized_check (sonde figée, aucune ligne créée)", () => {
  it("l'expression est bien évaluée : une majuscule et un blanc de bord bruts sont refusés, une adresse normale passe", async () => {
    const v = await verdicts(["Jean@x.fr", " jean@x.fr", "jean@x.fr\t", "jean@x.fr"]);
    expect(v.get("Jean@x.fr")?.ok).toBe(false);
    expect(v.get(" jean@x.fr")?.ok).toBe(false);
    expect(v.get("jean@x.fr\t")?.ok).toBe(false);
    expect(v.get("jean@x.fr")?.ok).toBe(true);
  });

  it("chaque caractère ASCII imprimable, seul, au milieu et aux bords : la sortie passe, l'entrée non normalisée est refusée", async () => {
    const samples = ASCII_PRINTABLE.flatMap(shapesOf);
    const v = await verdicts([...samples, ...samples.map(normalizeEmail)]);
    expect(samples.map(normalizeEmail).filter((n) => v.get(n)?.ok !== true), "sortie refusée par le CHECK").toEqual([]);
    expect(samples.filter((s) => normalizeEmail(s) !== s && v.get(s)?.ok !== false), "entrée non normalisée acceptée par le CHECK").toEqual([]);
    // l'échantillon n'est pas vide de sens : des majuscules et des blancs de bord y figurent
    expect(samples.filter((s) => normalizeEmail(s) !== s).length).toBeGreaterThan(100);
  });

  it("chaque caractère de la classe trim() de JS, au bord gauche, au bord droit et aux deux : la sortie passe, l'entrée brute est refusée", async () => {
    for (const c of TRIM_CHARS) expect(`${c}x${c}`.trim(), hex(c)).toBe("x");
    const samples = TRIM_CHARS.flatMap((c) => [`${c}jean@x.fr`, `jean@x.fr${c}`, `${c}Jean@X.fr${c}`, `${c}${c}jean@x.fr${c}${c}`]);
    const v = await verdicts([...samples, ...samples.map(normalizeEmail)]);
    expect(samples.map(normalizeEmail).filter((n) => v.get(n)?.ok !== true)).toEqual([]);
    expect(samples.filter((s) => v.get(s)?.ok !== false), "blanc de bord non refusé par le CHECK").toEqual([]);
    // un blanc au MILIEU n'est ni retiré ni refusé : les deux côtés sont d'accord
    const middle = TRIM_CHARS.map((c) => `jean${c}dupont@x.fr`);
    const vm = await verdicts(middle);
    expect(middle.filter((s) => normalizeEmail(s) !== s)).toEqual([]);
    expect(middle.filter((s) => vm.get(s)?.ok !== true)).toEqual([]);
  });

  it("chaque caractère que JS met en minuscules, seul, entre deux lettres et aux bords : la sortie passe toujours", async () => {
    const samples = JS_LOWERED.flatMap(shapesOf);
    const v = await verdicts(samples.map(normalizeEmail));
    const refused = [...new Set(samples)].filter((s) => v.get(normalizeEmail(s))?.ok !== true);
    expect(refused.map(hex)).toEqual([]);
    expect(JS_LOWERED.length).toBeGreaterThan(1000);
  });

  it("les points de code divergents : ce que fait réellement la base est mesuré sur chacun", async () => {
    const v = await verdicts([...JS_LOWERED, ...JS_LOWERED.map(normalizeEmail)]);
    const violations: string[] = [];
    for (const c of JS_LOWERED) {
      const raw = v.get(c)!;
      const lowered = v.get(normalizeEmail(c))!;
      // La sortie normalisée passe toujours.
      if (!lowered.ok) violations.push(`${hex(c)} normalisé refusé`);
      // La majuscule brute passe le CHECK exactement quand Postgres la laisse telle quelle (CHECK = `email = lower(email)` + bords).
      if (raw.ok !== raw.pgLowerLeavesItAlone) violations.push(`${hex(c)} brut : CHECK=${raw.ok}, lower inchangé=${raw.pgLowerLeavesItAlone}`);
    }
    expect(violations).toEqual([]);
    // La mesure n'est pas vide : au moins un point de code que Postgres ne sait pas mettre en minuscules ou met autrement que JS.
    const divergent = JS_LOWERED.filter((c) => v.get(c)!.pgLowerLeavesItAlone || c === "İ");
    expect(divergent.length).toBeGreaterThan(0);
  });

  it("les 28 majuscules Unicode 17 que Postgres ne met pas en minuscules : la base ACCEPTE la majuscule brute (résidu énoncé par la migration), l'application stocke la minuscule", async () => {
    const chars = DOCUMENTED_UNTOUCHED_BY_POSTGRES.map((cp) => String.fromCodePoint(cp));
    const v = await verdicts([...chars, ...chars.map((c) => `a${c}@x.fr`), ...chars.map(normalizeEmail)]);
    let compared = 0;
    for (const c of chars) {
      if (c.toLowerCase() === c) continue; // un ICU plus ancien qu'Unicode 17 ne la met pas en minuscules : rien à comparer
      compared += 1;
      if (v.get(c)!.pgLowerLeavesItAlone) {
        // Postgres (glibc 2.41) ne la connaît pas comme majuscule : brute acceptée.
        expect(v.get(c)!.ok, `${hex(c)} brut`).toBe(true);
        expect(v.get(`a${c}@x.fr`)!.ok, `${hex(c)} au milieu`).toBe(true);
      } else {
        // une glibc plus récente la met en minuscules : le filet refuse désormais la majuscule brute
        expect(v.get(c)!.ok, `${hex(c)} brut`).toBe(false);
      }
      expect(v.get(normalizeEmail(c))!.ok, `${hex(c)} normalisé`).toBe(true);
    }
    expect(compared, "aucun des 28 points de code n'est mis en minuscules par ce Node : ICU trop ancien pour cette preuve").toBeGreaterThan(0);
  });

  it("U+0130 « İ » : JS donne « i » + U+0307, Postgres « i » ; la base refuse la majuscule brute, la forme normalisée passe", async () => {
    const v = await verdicts(["İ", "İ@x.fr", normalizeEmail("İ@x.fr")]);
    expect(normalizeEmail("İ")).toBe("i̇");
    expect(v.get("İ")!.ok).toBe(false);
    expect(v.get("İ@x.fr")!.ok).toBe(false);
    expect(v.get("i̇@x.fr")!.ok).toBe(true);
  });

  it("le sigma final : JS donne « ς », Postgres « σ » ; « ΟΔΟΣ » brut est refusé, « οδος » de l'application passe", async () => {
    const withDomain = "ΟΔΟΣ@x.gr";
    const bare = "ΟΔΟΣ";
    expect(normalizeEmail(bare)).toBe("οδος");
    const v = await verdicts([withDomain, bare, normalizeEmail(withDomain), normalizeEmail(bare), "οδοσ@x.gr"]);
    expect(v.get(withDomain)!.ok).toBe(false);
    expect(v.get(bare)!.ok).toBe(false);
    expect(v.get(normalizeEmail(withDomain))!.ok).toBe(true);
    expect(v.get(normalizeEmail(bare))!.ok).toBe(true);
    // ce qu'un écrivain brut pourrait stocker à la place : accepté aussi (minuscule pour Postgres)
    expect(v.get("οδοσ@x.gr")!.ok).toBe(true);
  });

  it("des adresses réalistes : la sortie passe, ce que normalizeEmail change est refusé brut, ce qu'il laisse passe tel quel", async () => {
    const v = await verdicts([...REALISTIC, ...REALISTIC.map(normalizeEmail)]);
    expect(REALISTIC.map(normalizeEmail).filter((n) => v.get(n)?.ok !== true)).toEqual([]);
    expect(REALISTIC.filter((s) => normalizeEmail(s) !== s && v.get(s)?.ok !== false)).toEqual([]);
    expect(REALISTIC.filter((s) => normalizeEmail(s) === s && v.get(s)?.ok !== true)).toEqual([]);
  });
});
