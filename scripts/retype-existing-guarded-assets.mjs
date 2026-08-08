// One-shot migration script — re-type every EXISTING Cloudinary asset from
// public ("upload") to guarded ("authenticated") delivery, and flip the
// matching database row's `deliveryType` to match.
//
// Plain JavaScript ESM, executable directly by `node` — no `tsx`, no build
// step. Deliberately self-contained: it talks to Postgres with `pg` (raw SQL)
// and to Cloudinary with the `cloudinary` SDK directly, rather than importing
// lib/prisma.ts or app/generated/prisma/* — the generated Prisma client is
// TypeScript source with extensionless relative imports (`./enums`, etc.),
// which plain Node cannot resolve without a bundler or a transpiler. Runnable
// TypeScript-with-only-erasable-syntax modules (e.g. lib/cloudinaryDelivery.ts)
// ARE something a recent `node` can import directly, but this script avoids
// leaning on that too: it is the one piece of this feature that is allowed to
// touch every existing row in production, so it stays plain JS end to end,
// with its own tiny copies of the two Cloudinary enum mappings it needs
// (duplicated on purpose — see toCloudinaryType/toCloudinaryResourceType
// below — rather than depend on Node's type-stripping support staying
// compatible with whatever lib/cloudinaryDelivery.ts happens to contain).
//
// -----------------------------------------------------------------------
// WHY THIS EXISTS
// -----------------------------------------------------------------------
// The guarded-delivery migration (prisma/migrations/20260808100000_guarded_
// asset_delivery) and the code that signs `GET /api/assets/[kind]/[id]`
// only change how NEW uploads and NEW requests behave. Every ProjectFile,
// ReservePlan and ReservePhoto row created before that change is still
// `deliveryType = 'UPLOAD'`, and its Cloudinary asset is still stored with
// `type: "upload"` — i.e. still fetchable by anyone who has the URL, no
// session required. This script is what actually closes that gap for
// existing data. Until it has run (and finished with zero failures), those
// assets remain publicly reachable — see `GET /api/health`, which surfaces a
// live count of rows still in `deliveryType = 'UPLOAD'` for exactly this
// reason.
//
// Explicitly OUT OF SCOPE, left public on purpose: Client.photoUrl and
// AppSettings.logoUrl. Neither ProjectFile, ReservePlan nor ReservePhoto
// overlaps them — nothing here touches those columns or their Cloudinary
// assets. See prisma/schema.prisma's comment on Client.photoUrl for why it
// specifically stays out (it is not the same reason as the logo).
//
// -----------------------------------------------------------------------
// WHAT BREAKS THE MOMENT A ROW FLIPS
// -----------------------------------------------------------------------
// Any URL for that asset that was ever copy-pasted or emailed out — a plan
// link sent to a subcontractor, a photo pasted into a report, a direct
// Cloudinary URL saved somewhere — stops working the instant its row
// flips. That is the intended effect (those links were never supposed to
// bypass the app's authorization), but it is a real, immediate, one-way
// change for anyone still relying on an old link. There is no grace period
// per asset: `rename` re-types the asset atomically on Cloudinary's side.
//
// -----------------------------------------------------------------------
// HOW TO RUN IT IN PRODUCTION (docker exec, no tunnel, no local credentials)
// -----------------------------------------------------------------------
// The script needs DATABASE_URL and CLOUDINARY_URL, which only exist inside
// the running `web` container's environment (Postgres exposes no port to the
// host — see docker-compose.prod.yml). Run it THERE with `docker exec`,
// never by copying credentials to a workstation. See deploy/README.md for
// the full walkthrough; summary:
//
//   docker exec fullstack_starter_web node scripts/retype-existing-guarded-assets.mjs
//   docker exec fullstack_starter_web node scripts/retype-existing-guarded-assets.mjs --dry-run
//
// Both print exactly what WOULD flip, grouped by project, with totals, and
// touch nothing — no Cloudinary call, no database write. Dry-run is also the
// default with no flags at all.
//
// To actually run it:
//
//   docker exec fullstack_starter_web node scripts/retype-existing-guarded-assets.mjs --execute
//
// Optional tuning (Cloudinary rate limits vary by plan — lower these if the
// account starts throttling, e.g. run reports 420/"Too Many Requests"):
//
//   docker exec fullstack_starter_web node scripts/retype-existing-guarded-assets.mjs --execute --concurrency=2 --pause-ms=1000
//
// `--concurrency` (default 4) bounds how many rows are in flight to
// Cloudinary at once; `--pause-ms` (default 300) is the pause inserted
// between one batch finishing and the next starting.
//
// -----------------------------------------------------------------------
// IF IT STOPS PARTWAY THROUGH (network blip, container restart, Cloudinary
// quota, the `docker exec` session getting dropped, ...)
// -----------------------------------------------------------------------
// Just run the exact same `--execute` command again. It is idempotent and
// resumable by construction:
//
//   - Every run re-queries `WHERE "deliveryType" = 'UPLOAD'` from scratch, so
//     rows already flipped in a previous run are simply not selected again.
//   - Per row, the Cloudinary `rename` happens BEFORE the database `UPDATE`
//     (never the other way around, never batched separately — see
//     `processAsset` below) — so a crash mid-row leaves that ONE row
//     exactly where it was (still `UPLOAD`, asset still `upload` on
//     Cloudinary's side) or exactly where it should be (both flipped).
//     There is no state where an asset is re-typed on Cloudinary but the
//     row still says `UPLOAD` with no way to notice — see the next point.
//   - The one edge case that isn't simply "not selected again": a row whose
//     Cloudinary `rename` succeeded on a PRIOR run but whose database
//     `UPDATE` never happened (the process died in between). On the next
//     run, `rename` is attempted again on that row, fails with a 404
//     because the asset no longer exists under `type: "upload"` (it was
//     already moved), and — instead of reporting that as a failure — the
//     script verifies whether the AUTHENTICATED counterpart already exists
//     and, if so, treats it as "repaired": the row gets the `UPDATE` it was
//     missing, using the version Cloudinary reports for the asset AS IT
//     EXISTS TODAY (never the stale one from the failed run). See
//     `looksLikeNotFound` / `processAsset`'s catch branch.
//
// The run ends with a summary (flipped / repaired / skipped / failed) and,
// for every failure, its model + row id + publicId. It exits non-zero if
// any failures remain — re-running is exactly what to do; nothing here
// needs to be undone by hand first.
//
// -----------------------------------------------------------------------
// SECURITY NOTE
// -----------------------------------------------------------------------
// This script never builds or logs a delivery URL (signed or not) for any
// asset — it only ever logs `publicId` (a storage path, not a secret) plus
// whatever Cloudinary's error `message`/`http_code` say. `describeError`
// below is deliberately narrow about what it extracts from a thrown error:
// Cloudinary's SDK error objects can carry `request_options.auth`, which
// contains the API secret, when `hide_sensitive` isn't configured — so the
// raw error is never logged whole, only its `message` and `http_code`.
//
// -----------------------------------------------------------------------
// TEST COVERAGE
// -----------------------------------------------------------------------
// tests/retype-existing-guarded-assets.test.ts covers every pure function
// below (batching, error classification, response parsing, report
// formatting, arg parsing) without any network or database access. The
// functions that actually call Cloudinary or Postgres — fetchPending*,
// markAuthenticated, processAsset, main — are IO and are NOT covered by
// that suite; they were not exercised against a live Cloudinary account or
// database in this change (no network access here). Read them carefully
// before running `--execute` against production.

import "dotenv/config";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { v2 as cloudinary } from "cloudinary";
import pg from "pg";

const { Pool } = pg;

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_PAUSE_MS = 300;

export const MODEL_ORDER = ["ProjectFile", "ReservePlan", "ReservePhoto"];

// --- CLI args -----------------------------------------------------------

export function readIntFlag(argv, name) {
  const prefix = `${name}=`;
  const arg = argv.find((a) => a.startsWith(prefix));
  if (!arg) return null;
  const value = Number.parseInt(arg.slice(prefix.length), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseArgs(argv) {
  return {
    execute: argv.includes("--execute"),
    concurrency: readIntFlag(argv, "--concurrency") ?? DEFAULT_CONCURRENCY,
    pauseMs: readIntFlag(argv, "--pause-ms") ?? DEFAULT_PAUSE_MS,
  };
}

// --- Cloudinary enum mapping ---------------------------------------------
//
// Deliberately duplicated from lib/cloudinaryDelivery.ts rather than
// imported — see the header note at the top of this file.

function toCloudinaryType(deliveryType) {
  return deliveryType === "AUTHENTICATED" ? "authenticated" : "upload";
}

function toCloudinaryResourceType(resourceType) {
  switch (resourceType) {
    case "IMAGE":
      return "image";
    case "VIDEO":
      return "video";
    case "RAW":
      return "raw";
    default:
      throw new Error(`Unhandled resourceType: ${String(resourceType)}`);
  }
}

// --- Cloudinary response / error parsing ---------------------------------
//
// `cloudinary.uploader.rename` and `cloudinary.api.resource` are both
// untyped by the SDK — there is no typed response shape to lean on. Both are
// external input exactly like a webhook body, so they're validated by schema
// before anything is read off them, never trusted or cast.

const cloudinaryAssetResponseSchema = z
  .object({ version: z.union([z.number(), z.string()]).optional() })
  .passthrough();

/**
 * The delivery version to persist, straight off a `rename`/`resource`
 * response — never the previous value, never guessed. Cloudinary's own
 * response is the only source of truth for whether the version changed.
 */
export function extractVersion(response) {
  const parsed = cloudinaryAssetResponseSchema.safeParse(response);
  if (!parsed.success || parsed.data.version == null) return null;
  return String(parsed.data.version);
}

const cloudinaryErrorShapeSchema = z
  .object({ http_code: z.number().optional(), message: z.string().optional() })
  .passthrough();

/**
 * True when a `rename` rejection looks like Cloudinary's "no such asset"
 * response. NOT verified against a live call in this change (no network
 * access) — see the script header. Deliberately keyed off `http_code ===
 * 404` alone rather than the exact `message` text, and deliberately safe to
 * be wrong about either: the branch this gates (see `processAsset`) doesn't
 * trust the error at all, it re-verifies against Cloudinary itself before
 * repairing anything. A 404 unrelated to a prior partial run just costs one
 * extra read-only lookup before being reported as a real failure.
 */
export function looksLikeNotFound(error) {
  const parsed = cloudinaryErrorShapeSchema.safeParse(error);
  return parsed.success && parsed.data.http_code === 404;
}

/**
 * The only thing ever pulled out of a thrown Cloudinary error for logging —
 * see the script header's security note. Never logs the raw error object:
 * `request_options` (present when `hide_sensitive` isn't configured) carries
 * the API secret.
 */
export function describeError(error) {
  const parsed = cloudinaryErrorShapeSchema.safeParse(error);
  if (parsed.success && (parsed.data.message != null || parsed.data.http_code != null)) {
    const code = parsed.data.http_code != null ? ` (HTTP ${parsed.data.http_code})` : "";
    return `${parsed.data.message ?? "Erreur Cloudinary inconnue"}${code}`;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Erreur inconnue";
}

// --- Batching -------------------------------------------------------------

export function chunk(items, size) {
  if (size <= 0) throw new Error("chunk size must be a positive integer");
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `worker` over `items`, at most `batchSize` in flight at once, pausing
 * `pauseMs` between one batch finishing and the next starting. This is the
 * "concurrency bounded, paced" requirement — a script that gets rate-limited
 * mid-way through a production account is worse than a slow one.
 */
export async function runInBatches(items, batchSize, worker, pauseMs) {
  const results = [];
  const batches = chunk(items, batchSize);
  for (let i = 0; i < batches.length; i++) {
    const batchResults = await Promise.all(batches[i].map((item) => worker(item)));
    results.push(...batchResults);
    if (i < batches.length - 1) await sleep(pauseMs);
  }
  return results;
}

// --- Reporting --------------------------------------------------------

function emptyCounts() {
  return { ProjectFile: 0, ReservePlan: 0, ReservePhoto: 0 };
}

export function groupByProject(assets) {
  const byProject = new Map();
  for (const asset of assets) {
    let group = byProject.get(asset.projectId);
    if (!group) {
      group = {
        projectId: asset.projectId,
        projectName: asset.projectName,
        projectDeleted: asset.projectDeleted,
        counts: emptyCounts(),
        total: 0,
      };
      byProject.set(asset.projectId, group);
    }
    group.counts[asset.model] += 1;
    group.total += 1;
  }
  return [...byProject.values()].sort(
    (a, b) => a.projectName.localeCompare(b.projectName) || a.projectId - b.projectId
  );
}

export function grandTotals(assets) {
  const counts = emptyCounts();
  for (const asset of assets) counts[asset.model] += 1;
  return { counts, total: assets.length };
}

export function formatDryRunReport(assets) {
  const lines = [];
  lines.push("[DRY RUN] Aucune modification effectuee (ni Cloudinary, ni base de donnees).");
  lines.push("Relancer avec --execute pour appliquer.");
  lines.push("");

  const groups = groupByProject(assets);
  for (const group of groups) {
    const deletedTag = group.projectDeleted ? " [projet supprime]" : "";
    lines.push(`Projet #${group.projectId} - ${group.projectName}${deletedTag}`);
    for (const model of MODEL_ORDER) {
      const count = group.counts[model];
      if (count > 0) lines.push(`  ${model}: ${count}`);
    }
    lines.push(`  Total: ${group.total}`);
    lines.push("");
  }

  const grand = grandTotals(assets);
  lines.push("Totaux:");
  for (const model of MODEL_ORDER) {
    lines.push(`  ${model}: ${grand.counts[model]}`);
  }
  lines.push(`  Projets concernes: ${groups.length}`);
  lines.push(`  Total general: ${grand.total}`);
  return lines;
}

export function formatExecutionSummary(outcomes) {
  let flipped = 0;
  let repaired = 0;
  let skipped = 0;
  const failures = [];

  for (const outcome of outcomes) {
    if (outcome.status === "flipped") flipped += 1;
    else if (outcome.status === "repaired") repaired += 1;
    else if (outcome.status === "skipped") skipped += 1;
    else failures.push({ model: outcome.asset.model, id: outcome.asset.id, publicId: outcome.asset.publicId, error: outcome.error });
  }

  const lines = [];
  lines.push("Resume:");
  lines.push(`  Bascules (rename + update): ${flipped}`);
  lines.push(`  Repares (deja renommes lors d'un run precedent, ligne remise a jour): ${repaired}`);
  lines.push(`  Ignores (deja a jour, probablement un run concurrent): ${skipped}`);
  lines.push(`  Echoues: ${failures.length}`);
  if (failures.length > 0) {
    lines.push("");
    lines.push("Echecs (relancer le script une fois corrige - il est idempotent) :");
    for (const failure of failures) {
      lines.push(`  ${failure.model}#${failure.id} (publicId="${failure.publicId}"): ${failure.error}`);
    }
  }
  return lines;
}

// --- Database ---------------------------------------------------------
//
// Raw SQL via `pg`, not the generated Prisma client — see the header note.
// Table and column names are quoted exactly as Prisma declares them
// (no `@map` in the schema, so they match the model/field names verbatim).

let pool;
function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

async function fetchPendingProjectFiles() {
  const { rows } = await getPool().query(`
    SELECT pf.id AS id, pf."publicId" AS "publicId", pf."resourceType" AS "resourceType",
           p.id AS "projectId", p.name AS "projectName", p."deletedAt" AS "projectDeletedAt"
    FROM "ProjectFile" pf
    JOIN "Project" p ON p.id = pf."projectId"
    WHERE pf."deliveryType" = 'UPLOAD'
    ORDER BY pf.id ASC
  `);
  return rows.map((row) => ({
    model: "ProjectFile",
    id: row.id,
    publicId: row.publicId,
    resourceType: row.resourceType,
    projectId: row.projectId,
    projectName: row.projectName,
    projectDeleted: row.projectDeletedAt != null,
  }));
}

async function fetchPendingReservePlans() {
  const { rows } = await getPool().query(`
    SELECT rp.id AS id, rp."publicId" AS "publicId", rp."resourceType" AS "resourceType",
           p.id AS "projectId", p.name AS "projectName", p."deletedAt" AS "projectDeletedAt"
    FROM "ReservePlan" rp
    JOIN "Project" p ON p.id = rp."projectId"
    WHERE rp."deliveryType" = 'UPLOAD'
    ORDER BY rp.id ASC
  `);
  return rows.map((row) => ({
    model: "ReservePlan",
    id: row.id,
    publicId: row.publicId,
    resourceType: row.resourceType,
    projectId: row.projectId,
    projectName: row.projectName,
    projectDeleted: row.projectDeletedAt != null,
  }));
}

async function fetchPendingReservePhotos() {
  // ReservePhoto has no projectId of its own — its project is reached via
  // reserve -> project. Reserve DOES carry a denormalised `projectId` column
  // (see prisma/schema.prisma's Reserve model), so a plain SQL join reaches
  // it in one hop; Prisma's own `include` can't use it because that column
  // has no declared `@relation`, but raw SQL isn't bound by that.
  const { rows } = await getPool().query(`
    SELECT rp.id AS id, rp."publicId" AS "publicId", rp."resourceType" AS "resourceType",
           p.id AS "projectId", p.name AS "projectName", p."deletedAt" AS "projectDeletedAt"
    FROM "ReservePhoto" rp
    JOIN "Reserve" r ON r.id = rp."reserveId"
    JOIN "Project" p ON p.id = r."projectId"
    WHERE rp."deliveryType" = 'UPLOAD'
    ORDER BY rp.id ASC
  `);
  return rows.map((row) => ({
    model: "ReservePhoto",
    id: row.id,
    publicId: row.publicId,
    resourceType: row.resourceType,
    projectId: row.projectId,
    projectName: row.projectName,
    projectDeleted: row.projectDeletedAt != null,
  }));
}

async function fetchAllPending() {
  const [files, plans, photos] = await Promise.all([
    fetchPendingProjectFiles(),
    fetchPendingReservePlans(),
    fetchPendingReservePhotos(),
  ]);
  return [...files, ...plans, ...photos];
}

const TABLE_BY_MODEL = {
  ProjectFile: '"ProjectFile"',
  ReservePlan: '"ReservePlan"',
  ReservePhoto: '"ReservePhoto"',
};

/**
 * Flips exactly one row to AUTHENTICATED with the version Cloudinary just
 * reported. Guarded by `"deliveryType" = 'UPLOAD'` in the WHERE clause (not
 * just `id`) so a concurrent/duplicate run of this script can't double
 * apply — a second writer simply matches zero rows and the caller treats
 * that as "already done" (`skipped`), never as an error.
 *
 * One `UPDATE` per row, issued right after that row's own `rename` — never
 * batched globally — is deliberate here (see the script header's "if it
 * stops partway" section), not an oversight of the "no query in a loop"
 * convention. The table name is interpolated from `TABLE_BY_MODEL`, a fixed,
 * hardcoded map keyed by `asset.model` (always one of MODEL_ORDER, never
 * user input) — never built from anything external.
 */
async function markAuthenticated(asset, version) {
  const table = TABLE_BY_MODEL[asset.model];
  if (!table) throw new Error(`Unhandled model: ${String(asset.model)}`);
  const result = await getPool().query(
    `UPDATE ${table} SET "deliveryType" = 'AUTHENTICATED', "version" = $1 WHERE id = $2 AND "deliveryType" = 'UPLOAD'`,
    [version, asset.id]
  );
  return result.rowCount > 0;
}

// --- Per-row processing -------------------------------------------------

/**
 * Re-types one asset on Cloudinary, THEN updates its row — never the other
 * way around, never decoupled into separate bulk passes (see the script
 * header). `resource_type` always comes from the stored, guarded column
 * (`asset.resourceType`), never re-derived from a mime type.
 */
async function processAsset(asset) {
  const resourceType = toCloudinaryResourceType(asset.resourceType);

  try {
    const result = await cloudinary.uploader.rename(asset.publicId, asset.publicId, {
      resource_type: resourceType,
      type: toCloudinaryType("UPLOAD"),
      to_type: toCloudinaryType("AUTHENTICATED"),
    });
    const updated = await markAuthenticated(asset, extractVersion(result));
    return { status: updated ? "flipped" : "skipped", asset };
  } catch (renameError) {
    if (!looksLikeNotFound(renameError)) {
      return { status: "failed", asset, error: describeError(renameError) };
    }

    // Possibly a prior, interrupted run already renamed this asset and
    // never got to the UPDATE — verify against Cloudinary's own state
    // rather than trusting the error's wording (see looksLikeNotFound).
    try {
      const existing = await cloudinary.api.resource(asset.publicId, {
        resource_type: resourceType,
        type: toCloudinaryType("AUTHENTICATED"),
      });
      const updated = await markAuthenticated(asset, extractVersion(existing));
      return { status: updated ? "repaired" : "skipped", asset };
    } catch (verifyError) {
      return {
        status: "failed",
        asset,
        error: `rename echoue (${describeError(renameError)}) ; verification echouee aussi (${describeError(verifyError)})`,
      };
    }
  }
}

// --- Entry point ----------------------------------------------------------

async function main() {
  cloudinary.config({ secure: true });

  const { execute, concurrency, pauseMs } = parseArgs(process.argv.slice(2));
  const assets = await fetchAllPending();

  if (assets.length === 0) {
    console.log("Rien a faire : aucune ligne en deliveryType = UPLOAD.");
    return;
  }

  if (!execute) {
    for (const line of formatDryRunReport(assets)) console.log(line);
    return;
  }

  console.log(
    `Execution reelle sur ${assets.length} ligne(s) - concurrence=${concurrency}, pause=${pauseMs}ms entre lots.`
  );
  const outcomes = await runInBatches(assets, concurrency, processAsset, pauseMs);
  for (const line of formatExecutionSummary(outcomes)) console.log(line);

  const hasFailures = outcomes.some((outcome) => outcome.status === "failed");
  if (hasFailures) process.exitCode = 1;
}

// Only runs when invoked directly (`node scripts/retype-existing-guarded-
// assets.mjs`), never on import — the test file imports this module's pure
// functions without triggering any Cloudinary/database call.
const isMainModule = (() => {
  try {
    return process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main()
    .catch((error) => {
      console.error("Echec du script:", describeError(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      if (pool) await pool.end();
    });
}
