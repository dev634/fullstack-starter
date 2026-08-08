import { createHash } from "node:crypto";
import { requireAppUser } from "@/lib/requireAppUser";
import { canAccessSection } from "@/lib/sectionAccess";
import { canAccessArea } from "@/lib/areaAccess";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { isRateLimited, registerFailure } from "@/lib/rate-limit";
import { findById as findProjectById } from "@/repository/projects";
import { findById as findProjectFileById } from "@/repository/projectFiles";
import { findById as findReservePlanById } from "@/repository/reservePlans";
import { findByIdWithProjectId as findReservePhotoById } from "@/repository/reservePhotos";
import { buildDeliveryUrl, type DeliveryAsset } from "@/lib/cloudinaryDelivery";
import type { AssetKind } from "@/lib/assetPath";
import {
  assetKindSchema,
  assetIdSchema,
  assetQuerySchema,
  SECTION_BY_KIND,
  DISPOSITION_BY_KIND,
  buildAssetTransformation,
  mimeFromFormat,
  contentDispositionHeader,
} from "@/lib/assetDelivery";

// Bounds only the wait for Cloudinary's response HEADERS. The
// AbortController below is disarmed the instant fetch() resolves — BEFORE
// the body starts streaming through to the browser — so a legitimately
// slow-but-working transfer (a large plan/photo over a weak connection) can
// take as long as it needs instead of being severed mid-stream at the 20s
// mark. Previously this same deadline stayed armed for the fetch's entire
// lifetime, headers AND body, which is exactly backwards from what this
// comment used to claim.
const UPSTREAM_TIMEOUT_MS = 20000;

// Per-user budget on requests that actually reach Cloudinary — a 304
// revalidation is free and never counted against it (see the ETag check
// below). A single project page opens at most a handful of these at once,
// but an active editing session (add a plan, pin a few réserves, attach
// photos) triggers a full page refresh after every mutation, each one
// re-requesting the current plan image — this comfortably covers "several
// dozen" of those over a few minutes while still bounding the actual cost
// driver: every distinct kind/id/transformation combination is a separately
// billed, separately cached Cloudinary derivative.
const ASSET_DELIVERY_LIMIT = { limit: 300, windowMs: 5 * 60 * 1000 };

function errorResponse(body: string, status: number, extraHeaders?: Record<string, string>): Response {
  // Heuristically cacheable otherwise (a 404 in particular) — e.g. a
  // "Retry" button could resend nothing at all and resurface a stale error
  // straight from the browser's own cache.
  return new Response(body, { status, headers: { "Cache-Control": "no-store", ...extraHeaders } });
}

type Resolved = {
  asset: DeliveryAsset;
  projectId: number;
  contentType: string;
  filename: string | null;
};

/**
 * Look up the row a request names — the ONLY thing the request supplies is
 * `kind` + a row id. Everything used to authorize and build the delivery URL
 * (publicId, the guarded columns, the owning project) is read back from that
 * row, never taken from the request itself: no publicId, no Cloudinary path,
 * no projectId ever comes from the caller (see docs/CONVENTIONS.md's anti-IDOR
 * rule — it applies to a delivery route exactly as it does to a mutation).
 *
 * Returns null when the row itself doesn't exist, which the caller folds
 * into the very same 404 as "row exists but its project is out of scope" —
 * a distinct status for the two would let a caller enumerate ids.
 */
async function resolveAsset(kind: AssetKind, id: number): Promise<Resolved | null> {
  switch (kind) {
    case "project-files": {
      const file = await findProjectFileById(id);
      if (!file) return null;
      return {
        asset: {
          publicId: file.publicId,
          resourceType: file.resourceType,
          format: file.format,
          version: file.version,
          deliveryType: file.deliveryType,
        },
        projectId: file.projectId,
        contentType: file.mimeType ?? mimeFromFormat(file.format) ?? "application/octet-stream",
        filename: file.name,
      };
    }
    case "reserve-plans": {
      const plan = await findReservePlanById(id);
      if (!plan) return null;
      return {
        asset: {
          publicId: plan.publicId,
          resourceType: plan.resourceType,
          format: plan.format,
          version: plan.version,
          deliveryType: plan.deliveryType,
        },
        projectId: plan.projectId,
        // Always rasterised to a JPG page (buildAssetTransformation forces
        // it) — the stored format ("pdf") never describes what's actually
        // delivered for this kind.
        contentType: "image/jpeg",
        filename: null,
      };
    }
    case "reserve-photos": {
      // A single query: the photo plus its reserve's projectId (ReservePhoto
      // has no projectId column of its own) — see
      // repository/reservePhotos.ts::findByIdWithProjectId's doc. Previously
      // this issued two separate reads of the very same row.
      const photo = await findReservePhotoById(id);
      if (!photo) return null;
      return {
        asset: {
          publicId: photo.publicId,
          resourceType: photo.resourceType,
          format: photo.format,
          version: photo.version,
          deliveryType: photo.deliveryType,
        },
        projectId: photo.reserve.projectId,
        contentType: mimeFromFormat(photo.format) ?? "application/octet-stream",
        filename: null,
      };
    }
  }
}

/**
 * Streams a guarded Cloudinary asset (ProjectFile / ReservePlan /
 * ReservePhoto) to the browser without ever handing it a Cloudinary URL —
 * signing happens here, server-side, on every request.
 *
 * A single parameterized route rather than three: all three kinds share the
 * exact same contract (resolve the row, authorize, sign, stream, cache
 * headers) and differ only in which repository to query, which section
 * governs them, and which transformation/disposition applies — see
 * lib/assetDelivery.ts. Tripling the streaming/ETag/error-handling body
 * across three files for that would be the "more than two occurrences"
 * case DRY calls out, for zero behavioural benefit.
 *
 * Authorization mirrors the existing precedent for a project-scoped export
 * (see app/clients/[id]/projects/[projectId]/reserves/report/route.ts):
 * session → area → section → RESOLVE THE ROW → project access. The row id is
 * the only thing the request supplies; see resolveAsset's doc for why the
 * project it belongs to is never taken from the URL/query instead.
 *
 * Out of scope reads as 404 throughout, including when the row itself
 * doesn't exist — a distinct status for "wrong project" versus "no such
 * row" would let a caller enumerate ids from the response alone.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> }
) {
  const gate = await requireAppUser();
  if (!gate.ok) return gate.response;

  // The `projects` rubrique — the same one gating the standalone /projects
  // list, its CSV export, and the project detail page (see
  // docs/CONVENTIONS.md's access-axes table). Checked before `kind` is even
  // parsed since it isn't tied to any one asset: files/plans/photos only
  // exist inside a project, so hiding the rubrique that reaches one must
  // hide what it contains too.
  if (!(await canAccessArea("projects"))) {
    return errorResponse("Forbidden", 403);
  }

  const { kind: kindRaw, id: idRaw } = await params;
  const kindParsed = assetKindSchema.safeParse(kindRaw);
  // Same status as the malformed-id check below, and for the same reason:
  // neither is resolved against the database, so there's nothing here that
  // could confirm or deny a specific row's existence — 404 is reserved for
  // that (see the project-scope check further down).
  if (!kindParsed.success) return errorResponse("Bad Request", 400);
  const kind = kindParsed.data;

  // Section access is a function-level restriction, not tied to any one row,
  // so refusing it plainly (403) doesn't confirm or deny a specific asset's
  // existence — unlike the project-scope check below, which does need to
  // stay indistinguishable from "not found".
  if (!(await canAccessSection(SECTION_BY_KIND[kind]))) {
    return errorResponse("Forbidden", 403);
  }

  const idParsed = assetIdSchema.safeParse(idRaw);
  if (!idParsed.success) return errorResponse("Bad Request", 400);

  const searchParams = new URL(request.url).searchParams;
  const queryParsed = assetQuerySchema.safeParse({
    page: searchParams.get("page") ?? undefined,
    width: searchParams.get("width") ?? undefined,
  });
  if (!queryParsed.success) return errorResponse("Bad Request", 400);

  try {
    // getAccessContext() is hoisted into the SAME Promise.all as resolving
    // the row (rather than only fetched once the row is known to exist) so
    // the "row doesn't exist" and "row exists but is out of scope" paths pay
    // for the same work up to this point — otherwise the second, slower path
    // (row lookup + access context + project lookup) is measurably slower
    // than the first (row lookup alone) at the network level, which
    // undermines the very anti-enumeration property the shared 404 below is
    // trying to buy. It's needed for the nominal path regardless.
    const [resolved, access] = await Promise.all([resolveAsset(kind, idParsed.data), getAccessContext()]);
    if (!resolved) return errorResponse("Not Found", 404);

    const project = await findProjectById(resolved.projectId);
    if (!project || project.deletedAt || !canReachProject(access, project.id)) {
      return errorResponse("Not Found", 404);
    }

    const transformation = buildAssetTransformation(kind, resolved.asset, queryParsed.data);

    // Derived from the ROW'S IDENTITY (kind + id + version + transformation),
    // never from the signed delivery URL: Cloudinary's URL signature is only
    // 48 bits, and hashing it directly would let a caller who legitimately
    // has it once (this route only ever hands it to someone already
    // authorized) recover it offline from the ETag and hold onto a
    // permanent, unguarded Cloudinary link — the exact thing signing
    // server-side on every request exists to prevent. Same cache behaviour
    // either way: a stable value that changes exactly when the delivered
    // bytes would.
    const etagSeed = JSON.stringify([kind, idParsed.data, resolved.asset.version, transformation ?? null]);
    const etag = `"${createHash("sha1").update(etagSeed).digest("hex")}"`;
    // private: never a shared/CDN cache, which would hand this file to
    // whoever the guard above just refused. no-cache: the browser may keep the
    // bytes, but must always revalidate with us first (via If-None-Match)
    // before reusing them — every revalidation re-runs this handler, so a
    // caller whose access is later revoked can't keep reading from a stale
    // local cache.
    const cacheControl = "private, no-cache";
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cacheControl } });
    }

    // Rate-limited from here on only: a 304 above never reaches Cloudinary,
    // so it must never count against — or write to — this budget.
    const userKey = `asset-delivery:${gate.value.email}`;
    const rl = await isRateLimited(userKey, ASSET_DELIVERY_LIMIT);
    if (rl.limited) {
      return errorResponse("Too Many Requests", 429, {
        "Retry-After": String(Math.max(1, Math.ceil(rl.retryAfterMs / 1000))),
      });
    }
    await registerFailure(userKey);

    const deliveryUrl = buildDeliveryUrl(resolved.asset, transformation);

    // See UPSTREAM_TIMEOUT_MS's doc: this controller is disarmed as soon as
    // fetch() resolves, so the deadline never governs the body stream below.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(deliveryUrl, {
        signal: controller.signal,
        cache: "no-store", // this route IS the cache boundary (ETag/304 above) — Next's own fetch cache must stay out of it
      });
    } catch (error) {
      console.error("Guarded asset delivery: upstream fetch failed", {
        kind,
        id: idParsed.data,
        error: error instanceof Error ? error.message : String(error),
      });
      return errorResponse("Bad Gateway", 502);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!upstream.ok || !upstream.body) {
      // Two distinct causes land here, both requiring a human rather than a
      // silent fallback: Cloudinary genuinely failing, or the row still reads
      // deliveryType UPLOAD while the one-shot re-typing script has already
      // flipped the ASSET ITSELF to authenticated on Cloudinary's side (a
      // partial-migration state) — buildDeliveryUrl then signs for the wrong
      // type. Deliberately NOT retried here with the opposite type: a guess
      // that happens to work would leave the row's deliveryType permanently
      // wrong in the database with nothing surfacing that it still needs the
      // script re-run on it. The signed URL itself is never logged (it's a
      // working, authenticated link); the row's identifying columns are.
      console.error("Guarded asset delivery: upstream responded", upstream.status, {
        kind,
        id: idParsed.data,
        publicId: resolved.asset.publicId,
        deliveryType: resolved.asset.deliveryType,
        resourceType: resolved.asset.resourceType,
      });
      return errorResponse("Bad Gateway", 502);
    }

    const headers = new Headers({
      "Content-Type": resolved.contentType,
      "Cache-Control": cacheControl,
      ETag: etag,
      "Content-Disposition": contentDispositionHeader(DISPOSITION_BY_KIND[kind], resolved.filename),
      // Belt-and-braces beyond next.config.ts's global header: two kinds
      // (reserve-plans, reserve-photos) are served `inline`, and a project
      // file's Content-Type comes from what the uploading browser declared —
      // pinning it here removes any doubt for this specific route.
      "X-Content-Type-Options": "nosniff",
    });
    const upstreamLength = upstream.headers.get("content-length");
    const upstreamEncoding = upstream.headers.get("content-encoding");
    // Only trustworthy when nothing sits between Cloudinary's byte count and
    // what actually reaches the browser: fetch() sends `accept-encoding:
    // gzip` and transparently decompresses, so an upstream `content-encoding`
    // means Content-Length still describes the COMPRESSED size — copying it
    // verbatim would make a gzipped .csv/.txt/.json look shorter than the
    // bytes that actually follow, and the browser truncates the download
    // without ever raising an error.
    if (upstreamLength && !upstreamEncoding) headers.set("Content-Length", upstreamLength);

    // Streamed straight through, never buffered: a project file can be up to
    // 20 MB, and buffering it (Buffer.from(await res.arrayBuffer())) would put
    // the whole thing in this process's memory for every concurrent download.
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    // Mirrors app/clients/[id]/projects/[projectId]/reserves/report/route.ts:
    // a repository throws a plain literal (not an Error) on a DB failure —
    // e.g. an id past what Postgres' int4 can hold — and without this catch
    // that propagates as an unstructured 500 instead of a controlled one.
    console.error("Guarded asset delivery: unexpected error", {
      kind,
      id: idParsed.data,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Internal Server Error", 500);
  }
}
