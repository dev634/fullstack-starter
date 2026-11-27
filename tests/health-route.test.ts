import { describe, it, expect, vi } from "vitest";

const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn<() => string>() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(async () => [{ "?column?": 1 }]),
    projectFile: { count: vi.fn(async () => 2) },
    reservePlan: { count: vi.fn(async () => 1) },
    reservePhoto: { count: vi.fn(async () => 0) },
  },
}));
vi.mock("@/lib/imageDecodeBridge", () => ({ imageDecoderState: stateMock }));

import { GET } from "@/app/api/health/route";

// The probe is PUBLIC: it says whether the image decoder could start, as one word, and never
// a pid, a message or a path. A decoder that cannot start refuses every photo upload, and the
// only other trace of it would be a log line.
describe("GET /api/health — imageDecoder", () => {
  it("reports the decoder state next to the existing fields, which are unchanged", async () => {
    stateMock.mockReturnValue("failed");
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", db: "ok", pendingGuardedAssets: 3, imageDecoder: "failed" });
    expect(Object.keys(body).sort()).toEqual(["db", "imageDecoder", "pendingGuardedAssets", "status", "timestamp", "version"]);
  });

  it.each(["ready", "idle"])("passes %s through as it is", async (state) => {
    stateMock.mockReturnValue(state);
    expect((await (await GET()).json()).imageDecoder).toBe(state);
  });
});
