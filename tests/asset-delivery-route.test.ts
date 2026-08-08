import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/requireAppUser", () => ({ requireAppUser: vi.fn() }));
vi.mock("@/lib/sectionAccess", () => ({ canAccessSection: vi.fn() }));
vi.mock("@/lib/areaAccess", () => ({ canAccessArea: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn(), registerFailure: vi.fn() }));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn(),
  canReachProject: vi.fn(),
}));
vi.mock("@/repository/projects", () => ({ findById: vi.fn() }));
vi.mock("@/repository/projectFiles", () => ({ findById: vi.fn() }));
vi.mock("@/repository/reservePlans", () => ({ findById: vi.fn() }));
vi.mock("@/repository/reservePhotos", () => ({ findByIdWithProjectId: vi.fn() }));
vi.mock("@/lib/cloudinaryDelivery", () => ({ buildDeliveryUrl: vi.fn() }));

import { GET } from "@/app/api/assets/[kind]/[id]/route";
import { requireAppUser } from "@/lib/requireAppUser";
import { canAccessSection } from "@/lib/sectionAccess";
import { canAccessArea } from "@/lib/areaAccess";
import { isRateLimited, registerFailure } from "@/lib/rate-limit";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { findById as findProjectById } from "@/repository/projects";
import { findById as findProjectFileById } from "@/repository/projectFiles";
import { findById as findReservePlanById } from "@/repository/reservePlans";
import { findByIdWithProjectId as findReservePhotoById } from "@/repository/reservePhotos";
import { buildDeliveryUrl } from "@/lib/cloudinaryDelivery";

const requireAppUserMock = vi.mocked(requireAppUser);
const canAccessSectionMock = vi.mocked(canAccessSection);
const canAccessAreaMock = vi.mocked(canAccessArea);
const isRateLimitedMock = vi.mocked(isRateLimited);
const registerFailureMock = vi.mocked(registerFailure);
const getAccessContextMock = vi.mocked(getAccessContext);
const canReachProjectMock = vi.mocked(canReachProject);
const findProjectByIdMock = vi.mocked(findProjectById);
const findProjectFileByIdMock = vi.mocked(findProjectFileById);
const findReservePlanByIdMock = vi.mocked(findReservePlanById);
const findReservePhotoByIdMock = vi.mocked(findReservePhotoById);
const buildDeliveryUrlMock = vi.mocked(buildDeliveryUrl);

const DELIVERY_URL = "https://res.cloudinary.com/demo/image/authenticated/s--sig--/v1/projects/5/asset.jpg";
/** A well-formed quoted sha1-hex ETag — the exact algorithm is an implementation detail this suite doesn't pin down. */
const ETAG_SHAPE = /^"[0-9a-f]{40}"$/;

function request(url: string, headers?: Record<string, string>): Request {
  return new Request(url, { headers });
}

function callGet(kind: string, id: string, opts: { search?: string; headers?: Record<string, string> } = {}) {
  return GET(request(`https://app.test/api/assets/${kind}/${id}${opts.search ?? ""}`, opts.headers), {
    params: Promise.resolve({ kind, id }),
  });
}

describe("GET /api/assets/[kind]/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());

    requireAppUserMock.mockResolvedValue({ ok: true, value: { email: "admin@example.com", role: "ADMIN" } });
    canAccessAreaMock.mockResolvedValue(true);
    canAccessSectionMock.mockResolvedValue(true);
    isRateLimitedMock.mockResolvedValue({ limited: false, retryAfterMs: 0 });
    registerFailureMock.mockResolvedValue(undefined);
    getAccessContextMock.mockResolvedValue({
      email: "admin@example.com",
      role: "ADMIN",
      hiddenSections: new Set(),
      hiddenAreas: new Set(),
      projectIds: null,
    } as never);
    canReachProjectMock.mockReturnValue(true);
    findProjectByIdMock.mockResolvedValue({ id: 5, deletedAt: null } as never);
    buildDeliveryUrlMock.mockReturnValue(DELIVERY_URL);

    findProjectFileByIdMock.mockResolvedValue({
      id: 1,
      projectId: 5,
      folderId: null,
      name: "devis.pdf",
      publicId: "projects/5/devis",
      deliveryType: "AUTHENTICATED",
      resourceType: "RAW",
      format: null,
      version: "1700000000",
      mimeType: "application/pdf",
    } as never);
    findReservePlanByIdMock.mockResolvedValue({
      id: 2,
      projectId: 5,
      folderId: null,
      name: "RDC",
      publicId: "projects/5/reserve-plans/rdc",
      deliveryType: "AUTHENTICATED",
      resourceType: "IMAGE",
      format: "pdf",
      version: "1700000001",
    } as never);
    findReservePhotoByIdMock.mockResolvedValue({
      id: 3,
      publicId: "projects/5/reserve-photos/a",
      deliveryType: "AUTHENTICATED",
      resourceType: "IMAGE",
      format: "jpg",
      version: "1700000002",
      reserve: { projectId: 5 },
    } as never);

    vi.mocked(fetch).mockResolvedValue(
      new Response("bytes", { status: 200, headers: { "content-length": "5" } })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses an unauthenticated/CLIENT caller before touching the database", async () => {
    requireAppUserMock.mockResolvedValue({ ok: false, response: new Response("Unauthorized", { status: 401 }) });
    const res = await callGet("project-files", "1");
    expect(res.status).toBe(401);
    expect(findProjectFileByIdMock).not.toHaveBeenCalled();
  });

  it("403s when the caller's function hides the `projects` rubrique — checked before `kind` is even parsed", async () => {
    canAccessAreaMock.mockResolvedValue(false);
    // A malformed kind would 400 on its own — proving the area check runs
    // first, before the request shape is even validated.
    const res = await callGet("not-a-real-kind", "1");
    expect(res.status).toBe(403);
    expect(canAccessSectionMock).not.toHaveBeenCalled();
    expect(findProjectFileByIdMock).not.toHaveBeenCalled();
  });

  it("400s an unknown kind (a routing-shape error, not a resolved-row check)", async () => {
    const res = await callGet("clients", "1");
    expect(res.status).toBe(400);
  });

  it("403s when the caller's function hides the owning section — checked before the row is even resolved", async () => {
    canAccessSectionMock.mockResolvedValue(false);
    // A malformed id would 400 on its own — proving section access is
    // checked first, exactly as it is in the reserves-report route.
    const res = await callGet("project-files", "not-a-number");
    expect(res.status).toBe(403);
    expect(findProjectFileByIdMock).not.toHaveBeenCalled();
  });

  it("400s a malformed id", async () => {
    const res = await callGet("project-files", "0");
    expect(res.status).toBe(400);
  });

  it("400s an id past Postgres' int4 range", async () => {
    const res = await callGet("project-files", "999999999999");
    expect(res.status).toBe(400);
    expect(findProjectFileByIdMock).not.toHaveBeenCalled();
  });

  it("400s a width outside the whitelist", async () => {
    const res = await callGet("reserve-photos", "3", { search: "?width=999" });
    expect(res.status).toBe(400);
    expect(findReservePhotoByIdMock).not.toHaveBeenCalled();
  });

  it("404s when the row itself doesn't exist", async () => {
    findProjectFileByIdMock.mockResolvedValue(null);
    const res = await callGet("project-files", "999");
    expect(res.status).toBe(404);
  });

  it("404s when a réserve photo's row doesn't exist", async () => {
    findReservePhotoByIdMock.mockResolvedValue(null);
    const res = await callGet("reserve-photos", "999");
    expect(res.status).toBe(404);
  });

  it("404s (not 403) when the row's project is out of the caller's scope — anti-enumeration", async () => {
    canReachProjectMock.mockReturnValue(false);
    const res = await callGet("project-files", "1");
    expect(res.status).toBe(404);
  });

  it("404s when the row's project is soft-deleted", async () => {
    findProjectByIdMock.mockResolvedValue({ id: 5, deletedAt: new Date() } as never);
    const res = await callGet("project-files", "1");
    expect(res.status).toBe(404);
  });

  it("500s (a controlled error, not an unhandled rejection) when the row resolution throws", async () => {
    // Repositories throw a plain literal (not an Error) on a DB failure —
    // this proves the route catches it instead of letting it become an
    // unstructured 500.
    findProjectFileByIdMock.mockRejectedValue({ type: "error", message: "Database Error fetching file." });
    const res = await callGet("project-files", "1");
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("never takes the project id from the request — only from the resolved row", async () => {
    // Even though the URL/params never carry a projectId at all, this also
    // proves findById(id) — never a caller-supplied projectId — is what
    // decides which project's access gets checked.
    await callGet("project-files", "1");
    expect(findProjectByIdMock).toHaveBeenCalledWith(5);
  });

  it("streams the project file as an attachment with a sanitized filename, from mimeType", async () => {
    const res = await callGet("project-files", "1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="devis.pdf"');
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("etag")).toMatch(ETAG_SHAPE);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("bytes");
  });

  it("streams a réserve plan inline as image/jpeg, always requesting page 1 by default", async () => {
    const res = await callGet("reserve-plans", "2");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(buildDeliveryUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({ publicId: "projects/5/reserve-plans/rdc" }),
      { page: 1, format: "jpg" }
    );
  });

  it("forwards a validated page + whitelisted width for a réserve plan", async () => {
    await callGet("reserve-plans", "2", { search: "?page=3&width=1600" });
    expect(buildDeliveryUrlMock).toHaveBeenCalledWith(expect.anything(), {
      page: 3,
      format: "jpg",
      width: 1600,
      crop: "limit",
      quality: "auto",
    });
  });

  it("streams a réserve photo inline, typed from its stored format (no mimeType column), resolving its project in one query", async () => {
    const res = await callGet("reserve-photos", "3");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(findReservePhotoByIdMock).toHaveBeenCalledWith(3);
    expect(findReservePhotoByIdMock).toHaveBeenCalledTimes(1);
  });

  it("answers 304 with no upstream call, and never touches the rate-limit budget, when If-None-Match matches", async () => {
    const first = await callGet("project-files", "1");
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(ETAG_SHAPE);
    vi.mocked(fetch).mockClear();
    isRateLimitedMock.mockClear();
    registerFailureMock.mockClear();

    const res = await callGet("project-files", "1", { headers: { "if-none-match": etag } });
    expect(res.status).toBe(304);
    expect(fetch).not.toHaveBeenCalled();
    expect(isRateLimitedMock).not.toHaveBeenCalled();
    expect(registerFailureMock).not.toHaveBeenCalled();
  });

  it("never sets Cache-Control to public", async () => {
    const res = await callGet("project-files", "1");
    expect(res.headers.get("cache-control")).not.toContain("public");
  });

  it("copies Content-Length from an uncompressed upstream response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("bytes", { status: 200, headers: { "content-length": "5" } })
    );
    const res = await callGet("project-files", "1");
    expect(res.headers.get("content-length")).toBe("5");
  });

  it("drops Content-Length when the upstream response is content-encoded (fetch decompresses, the header would describe the wrong size)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("bytes", { status: 200, headers: { "content-length": "5", "content-encoding": "gzip" } })
    );
    const res = await callGet("project-files", "1");
    expect(res.headers.get("content-length")).toBeNull();
  });

  describe("per-user rate limiting", () => {
    it("429s with a Retry-After once the budget is spent, without touching Cloudinary", async () => {
      isRateLimitedMock.mockResolvedValue({ limited: true, retryAfterMs: 45000 });
      const res = await callGet("project-files", "1");
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("45");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(fetch).not.toHaveBeenCalled();
      expect(registerFailureMock).not.toHaveBeenCalled();
    });

    it("checks the budget under a per-user key, and reserves an attempt on every real (non-304) fetch", async () => {
      await callGet("project-files", "1");
      expect(isRateLimitedMock).toHaveBeenCalledWith("asset-delivery:admin@example.com", expect.any(Object));
      expect(registerFailureMock).toHaveBeenCalledWith("asset-delivery:admin@example.com");
      expect(registerFailureMock).toHaveBeenCalledTimes(1);
    });
  });

  it("502s without leaking upstream detail when the Cloudinary fetch throws", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    const res = await callGet("project-files", "1");
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).not.toContain("network down");
  });

  // Covers both a genuine Cloudinary outage AND the partial-migration case:
  // deliveryType still reads UPLOAD in the DB while the one-shot script has
  // already re-typed the asset itself to authenticated on Cloudinary's side
  // — buildDeliveryUrl then signs for the wrong type and Cloudinary 401s.
  it("502s when Cloudinary responds with a non-OK status, never retrying with a guessed type", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    const res = await callGet("project-files", "1");
    expect(res.status).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
