import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/cloudinary", () => ({ destroyUploadedAsset: vi.fn() }));

import { assetCompensation, discardAfterFailedWrite, writeWithCompensation, type UploadCompensation } from "@/lib/uploadCompensation";
import { destroyUploadedAsset } from "@/lib/cloudinary";

const destroyUploadedAssetMock = vi.mocked(destroyUploadedAsset);
const ASSET = { publicId: "projects/1/a", deliveryType: "AUTHENTICATED", resourceType: "RAW" } as const;
const WRITE_ERROR = { type: "repositoryError", message: "Database Error." };

function compensation(overrides: Partial<UploadCompensation> = {}): UploadCompensation {
  return {
    label: "thing",
    publicId: "projects/1/a",
    isReferenced: vi.fn().mockResolvedValue(false),
    destroy: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("writeWithCompensation", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it("returns the write's result and destroys nothing on success", async () => {
    const c = compensation();
    await expect(writeWithCompensation(async () => 42, c)).resolves.toBe(42);
    expect(c.isReferenced).not.toHaveBeenCalled();
    expect(c.destroy).not.toHaveBeenCalled();
  });

  it("just runs the write when this call uploaded nothing (undefined)", async () => {
    await expect(writeWithCompensation(async () => { throw WRITE_ERROR; }, undefined)).rejects.toBe(WRITE_ERROR);
  });

  it("rethrows the ORIGINAL error and destroys the asset when nothing references it", async () => {
    const c = compensation();
    await expect(writeWithCompensation(async () => { throw WRITE_ERROR; }, c)).rejects.toBe(WRITE_ERROR);
    expect(c.isReferenced).toHaveBeenCalledTimes(1);
    expect(c.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps the asset when a row references it (the write may have committed anyway)", async () => {
    const c = compensation({ isReferenced: vi.fn().mockResolvedValue(true) });
    await expect(writeWithCompensation(async () => { throw WRITE_ERROR; }, c)).rejects.toBe(WRITE_ERROR);
    expect(c.destroy).not.toHaveBeenCalled();
  });

  it("keeps the asset and logs when the reference check itself fails", async () => {
    const readError = { type: "repositoryError" };
    const c = compensation({ isReferenced: vi.fn().mockRejectedValue(readError) });
    await expect(writeWithCompensation(async () => { throw WRITE_ERROR; }, c)).rejects.toBe(WRITE_ERROR);
    expect(c.destroy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Compensation skipped"), readError);
  });

  it("destroys WITHOUT asking when the failure proves the write did not happen", async () => {
    const c = compensation({ writeRefused: (e) => e === WRITE_ERROR, isReferenced: vi.fn().mockResolvedValue(true) });
    await expect(writeWithCompensation(async () => { throw WRITE_ERROR; }, c)).rejects.toBe(WRITE_ERROR);
    expect(c.isReferenced).not.toHaveBeenCalled();
    expect(c.destroy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the reference check for an error the refusal predicate does not recognise", async () => {
    const c = compensation({ writeRefused: () => false, isReferenced: vi.fn().mockResolvedValue(true) });
    await expect(writeWithCompensation(async () => { throw new Error("connection cut"); }, c)).rejects.toThrow("connection cut");
    expect(c.isReferenced).toHaveBeenCalledTimes(1);
    expect(c.destroy).not.toHaveBeenCalled();
  });

  it("keeps the ORIGINAL refusal, and logs, when the destruction throws", async () => {
    const destroyError = new Error("cloudinary down");
    const c = compensation({ destroy: vi.fn().mockRejectedValue(destroyError) });
    await expect(writeWithCompensation(async () => { throw WRITE_ERROR; }, c)).rejects.toBe(WRITE_ERROR);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Compensation failed"), destroyError);
  });
});

describe("discardAfterFailedWrite", () => {
  it("does nothing without a compensation", async () => {
    await expect(discardAfterFailedWrite(undefined, WRITE_ERROR)).resolves.toBeUndefined();
  });
});

describe("assetCompensation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks about, and destroys, the asset by the public id and type the upload reported", async () => {
    const isReferenced = vi.fn().mockResolvedValue(false);
    const c = assetCompensation("thing", ASSET, isReferenced);
    await writeWithCompensation(async () => { throw WRITE_ERROR; }, c).catch(() => undefined);
    expect(isReferenced).toHaveBeenCalledWith("projects/1/a");
    expect(destroyUploadedAssetMock).toHaveBeenCalledWith(ASSET);
  });
});
