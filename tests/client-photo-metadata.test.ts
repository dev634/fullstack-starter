import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

// REAL sharp on purpose: lib/imageMetadata is NOT mocked here (tests/cloudinary.test.ts
// mocks it, and a mocked strip proves nothing about what leaves the server). Only the
// Cloudinary SDK is replaced, to capture the exact buffer handed to upload_stream.
let sentBuffer: Buffer | null = null;

vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload_stream: vi.fn((_options: unknown, callback: (error: unknown, result: unknown) => void) => ({
        end: (buffer: Buffer) => {
          sentBuffer = buffer;
          callback(null, { secure_url: "https://res.cloudinary.com/demo/image/upload/v1/clients/x.jpg" });
        },
      })),
      destroy: vi.fn(),
    },
  },
}));

import { v2 as cloudinarySdk } from "cloudinary";
import { uploadClientPhoto } from "@/lib/cloudinary";

const uploadStreamMock = vi.mocked(cloudinarySdk.uploader.upload_stream);

/**
 * A real JPEG, 40x20 (landscape), carrying EXIF orientation 6 (the camera was held
 * in portrait: displayed, it is 20x40) and a GPS block.
 */
async function jpegWithOrientationAndGps(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 20, channels: 3, background: "#cc3300" } })
    .withExif({
      IFD0: { Make: "MARKER-MAKE" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "48/1 51/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "2/1 21/1 0/1",
      },
    })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}

// EXIF tag 0x8825 = pointer to the GPS IFD (little-endian as libvips writes it).
const GPS_IFD_POINTER = Buffer.from([0x25, 0x88]);

const REAL_HEIC_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00, 0x6d, 0x69, 0x66,
  0x31, 0x68, 0x65, 0x69, 0x63,
]);

beforeEach(() => {
  sentBuffer = null;
  uploadStreamMock.mockClear();
});

describe("uploadClientPhoto — the buffer that leaves is the stripped, oriented one (real sharp)", () => {
  it("the fixture really carries orientation 6, GPS and a 40x20 raster (otherwise the assertions below prove nothing)", async () => {
    const meta = await sharp(await jpegWithOrientationAndGps()).metadata();
    expect(meta.orientation).toBe(6);
    expect(meta.width).toBe(40);
    expect(meta.height).toBe(20);
    expect(meta.exif?.includes(GPS_IFD_POINTER)).toBe(true);
    expect(meta.exif?.includes("MARKER-MAKE")).toBe(true);
  });

  it("sends a JPEG with no EXIF/GPS left, and rotated: 20x40, orientation applied BEFORE the tag was dropped", async () => {
    const original = await jpegWithOrientationAndGps();
    await uploadClientPhoto(new File([new Uint8Array(original)], "photo.jpg", { type: "image/jpeg" }));

    expect(uploadStreamMock).toHaveBeenCalledTimes(1);
    expect(sentBuffer).not.toBeNull();
    const sent = sentBuffer as unknown as Buffer;
    expect(sent.equals(original)).toBe(false);

    const meta = await sharp(sent).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(sent.includes("MARKER-MAKE")).toBe(false);
    // Rotated into the pixels: a stripped-but-not-rotated copy would still be 40x20.
    expect(meta.width).toBe(20);
    expect(meta.height).toBe(40);
  });

  it("a HEIC stays accepted and is sent byte for byte unmodified (open point: its metadata is not stripped)", async () => {
    await expect(
      uploadClientPhoto(new File([REAL_HEIC_BYTES], "photo.heic", { type: "image/heic" }))
    ).resolves.toContain("res.cloudinary.com");
    expect(uploadStreamMock).toHaveBeenCalledTimes(1);
    const sent = sentBuffer as unknown as Buffer;
    expect(Buffer.from(REAL_HEIC_BYTES).equals(sent)).toBe(true);
  });

  it("a file with a JPEG signature that sharp cannot decode is refused, never sent as-is", async () => {
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    await expect(
      uploadClientPhoto(new File([truncated], "photo.jpg", { type: "image/jpeg" }))
    ).rejects.toMatchObject({ i18n: "uploadNotImage" });
    expect(uploadStreamMock).not.toHaveBeenCalled();
  });
});
