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
import { uploadClientPhoto as uploadClientPhotoOf } from "@/lib/cloudinary";
import { freshOwner } from "@/tests/helpers/imageAccount";

// The photo is decoded on behalf of an account: each call here is made by a fresh one.
const uploadClientPhoto = (file: File) => uploadClientPhotoOf(file, freshOwner());

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

// ---------------------------------------------------------------------------------------
// One block per format the company photo cleans (real sharp, real fixtures). Each fixture
// first PROVES it carries what must disappear — markers in the raw bytes, a GPS block, an
// orientation — otherwise "absent in the output" would prove nothing. The output is then
// read back both ways: structurally (the chunk list) and by searching the raw bytes.
// ---------------------------------------------------------------------------------------

const EXIF_WITH_GPS = {
  IFD0: { Make: "MARKER-MAKE" },
  IFD3: {
    GPSLatitudeRef: "N",
    GPSLatitude: "48/1 51/1 0/1",
    GPSLongitudeRef: "E",
    GPSLongitude: "2/1 21/1 0/1",
  },
};
const XMP_PACKET = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><MARKER-XMP/></rdf:RDF></x:xmpmeta>';

/** 40x20 PNG, EXIF orientation 6 (displayed: 20x40) + GPS. */
function landscapePngWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 20, channels: 3, background: "#cc3300" } })
    .withExif(EXIF_WITH_GPS)
    .withMetadata({ orientation: 6 })
    .png()
    .toBuffer();
}

async function sendThroughUploadClientPhoto(bytes: Buffer, name: string, type: string): Promise<Buffer> {
  sentBuffer = null;
  await uploadClientPhoto(new File([new Uint8Array(bytes)], name, { type }));
  expect(sentBuffer).not.toBeNull();
  return sentBuffer as unknown as Buffer;
}

/** The ordered chunk types of a PNG (everything after the 8-byte signature). */
function pngChunkTypes(png: Buffer): string[] {
  const types: string[] = [];
  let offset = 8;
  while (offset + 8 <= png.length) {
    types.push(png.toString("ascii", offset + 4, offset + 8));
    offset += 12 + png.readUInt32BE(offset);
  }
  return types;
}

/** The ordered chunk fourCCs of a RIFF/WebP file. */
function webpChunkTypes(webp: Buffer): string[] {
  const types: string[] = [];
  let offset = 12;
  while (offset + 8 <= webp.length) {
    types.push(webp.toString("ascii", offset, offset + 4));
    const size = webp.readUInt32LE(offset + 4);
    offset += 8 + size + (size % 2);
  }
  return types;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/** `png` with extra chunks inserted right after IHDR (8-byte signature + 25-byte IHDR chunk). */
function pngWithChunks(png: Buffer, chunks: Buffer[]): Buffer {
  const afterIhdr = 8 + 25;
  return Buffer.concat([png.subarray(0, afterIhdr), ...chunks, png.subarray(afterIhdr)]);
}

describe("uploadClientPhoto — PNG: text, XMP and eXIf chunks are gone, orientation applied (real sharp)", () => {
  it("sends a PNG with none of tEXt/iTXt/zTXt/eXIf, no marker, rotated to 20x40", async () => {
    const base = await landscapePngWithExif();
    const original = pngWithChunks(base, [
      pngChunk("tEXt", Buffer.from("Comment\0MARKER-TEXT", "latin1")),
      pngChunk("iTXt", Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\0\0\0\0", "latin1"), Buffer.from(XMP_PACKET)])),
    ]);
    // The fixture really carries every block, an orientation and a GPS IFD.
    expect(pngChunkTypes(original)).toEqual(expect.arrayContaining(["tEXt", "iTXt", "eXIf"]));
    const meta = await sharp(original).metadata();
    expect(meta.orientation).toBe(6);
    expect(meta.exif?.includes(GPS_IFD_POINTER)).toBe(true);
    for (const marker of ["MARKER-TEXT", "MARKER-XMP", "MARKER-MAKE"]) expect(original.includes(marker)).toBe(true);

    const sent = await sendThroughUploadClientPhoto(original, "photo.png", "image/png");

    const outTypes = pngChunkTypes(sent);
    for (const forbidden of ["tEXt", "iTXt", "zTXt", "eXIf", "iCCP"]) expect(outTypes).not.toContain(forbidden);
    for (const marker of ["MARKER-TEXT", "MARKER-XMP", "MARKER-MAKE"]) expect(sent.includes(marker)).toBe(false);
    const out = await sharp(sent).metadata();
    expect(out.format).toBe("png");
    expect(out.exif).toBeUndefined();
    expect(out.orientation).toBeUndefined();
    expect([out.width, out.height]).toEqual([20, 40]);
  });
});

describe("uploadClientPhoto — WebP: EXIF and XMP chunks are gone, orientation applied (real sharp)", () => {
  it("sends a WebP with no EXIF/XMP/ICCP chunk, no marker, rotated to 20x40", async () => {
    const original = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#cc3300" } })
      .withExif(EXIF_WITH_GPS)
      .withXmp(XMP_PACKET)
      .withMetadata({ orientation: 6 })
      .webp()
      .toBuffer();
    expect(webpChunkTypes(original)).toEqual(expect.arrayContaining(["EXIF", "XMP "]));
    const meta = await sharp(original).metadata();
    expect(meta.orientation).toBe(6);
    expect(meta.exif?.includes(GPS_IFD_POINTER)).toBe(true);
    for (const marker of ["MARKER-XMP", "MARKER-MAKE"]) expect(original.includes(marker)).toBe(true);

    const sent = await sendThroughUploadClientPhoto(original, "photo.webp", "image/webp");

    const outTypes = webpChunkTypes(sent);
    for (const forbidden of ["EXIF", "XMP ", "ICCP"]) expect(outTypes).not.toContain(forbidden);
    for (const marker of ["MARKER-XMP", "MARKER-MAKE"]) expect(sent.includes(marker)).toBe(false);
    const out = await sharp(sent).metadata();
    expect(out.format).toBe("webp");
    expect(out.exif).toBeUndefined();
    expect(out.orientation).toBeUndefined();
    expect([out.width, out.height]).toEqual([20, 40]);
  });
});

describe("uploadClientPhoto — GIF: the comment extension is gone (real sharp)", () => {
  it("sends a GIF without its comment; a GIF has no orientation, so the size is unchanged", async () => {
    const base = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#cc3300" } }).gif().toBuffer();
    // Comment Extension (0x21 0xFE, one sub-block, terminator) right after the header, the
    // logical screen descriptor and the global colour table.
    const globalColourTable = base[10] & 0x80 ? 3 * 2 ** ((base[10] & 0x07) + 1) : 0;
    const at = 13 + globalColourTable;
    const text = Buffer.from("MARKER-GIF-COMMENT", "ascii");
    const comment = Buffer.concat([Buffer.from([0x21, 0xfe, text.length]), text, Buffer.from([0x00])]);
    const original = Buffer.concat([base.subarray(0, at), comment, base.subarray(at)]);
    expect(original.includes("MARKER-GIF-COMMENT")).toBe(true);
    expect((await sharp(original).metadata()).format).toBe("gif");

    const sent = await sendThroughUploadClientPhoto(original, "photo.gif", "image/gif");

    expect(sent.includes("MARKER-GIF-COMMENT")).toBe(false);
    const out = await sharp(sent).metadata();
    expect(out.format).toBe("gif");
    expect([out.width, out.height]).toEqual([40, 20]);
  });
});

describe("uploadClientPhoto — AVIF: converted to a JPEG with no metadata, orientation applied (real sharp)", () => {
  it("sends a JPEG: no EXIF/GPS/XMP, no marker, 20x40", async () => {
    const original = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#cc3300" } })
      .withExif(EXIF_WITH_GPS)
      .withXmp(XMP_PACKET)
      .withMetadata({ orientation: 6 })
      .avif()
      .toBuffer();
    const meta = await sharp(original).metadata();
    expect(meta.format).toBe("heif");
    expect(meta.exif?.includes(GPS_IFD_POINTER)).toBe(true);
    expect(original.includes("MARKER-MAKE")).toBe(true);

    const sent = await sendThroughUploadClientPhoto(original, "photo.avif", "image/avif");

    expect(sent.equals(original)).toBe(false);
    const out = await sharp(sent).metadata();
    expect(out.format).toBe("jpeg");
    expect(out.exif).toBeUndefined();
    expect(out.xmp).toBeUndefined();
    expect(out.orientation).toBeUndefined();
    for (const marker of ["MARKER-MAKE", "MARKER-XMP"]) expect(sent.includes(marker)).toBe(false);
    expect([out.width, out.height]).toEqual([20, 40]);
  });
});

/**
 * A hand-built little-endian TIFF (sharp writes no GPS block into a TIFF): 40x20, 8-bit grey,
 * one uncompressed strip, with Make, Orientation 6 and a GPS IFD (tag 0x8825) holding a latitude.
 */
function tiffWithOrientationAndGps(): Buffer {
  const width = 40;
  const height = 20;
  const entry = (tag: number, type: number, count: number, value: number): Buffer => {
    const b = Buffer.alloc(12);
    b.writeUInt16LE(tag, 0);
    b.writeUInt16LE(type, 2);
    b.writeUInt32LE(count, 4);
    if (type === 3 && count === 1) b.writeUInt16LE(value, 8);
    else b.writeUInt32LE(value, 8);
    return b;
  };
  const make = Buffer.from("MARKER-MAKE\0", "ascii"); // 12 bytes
  const latitude = Buffer.alloc(24); // 3 RATIONALs: 48/1 51/1 0/1
  [48, 1, 51, 1, 0, 1].forEach((v, i) => latitude.writeUInt32LE(v, i * 4));
  const pixels = Buffer.alloc(width * height, 0x80);

  const ifd0Entries = 12;
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  const gpsEntries = 2;
  const gpsSize = 2 + gpsEntries * 12 + 4;
  const ifd0At = 8;
  const gpsAt = ifd0At + ifd0Size;
  const makeAt = gpsAt + gpsSize;
  const latitudeAt = makeAt + make.length;
  const pixelsAt = latitudeAt + latitude.length;

  const ifd0 = Buffer.concat([
    Buffer.from([ifd0Entries, 0]),
    entry(256, 3, 1, width),
    entry(257, 3, 1, height),
    entry(258, 3, 1, 8),
    entry(259, 3, 1, 1),
    entry(262, 3, 1, 1),
    entry(271, 2, make.length, makeAt),
    entry(273, 4, 1, pixelsAt),
    entry(274, 3, 1, 6),
    entry(277, 3, 1, 1),
    entry(278, 3, 1, height),
    entry(279, 4, 1, pixels.length),
    entry(0x8825, 4, 1, gpsAt),
    Buffer.alloc(4),
  ]);
  const gps = Buffer.concat([
    Buffer.from([gpsEntries, 0]),
    entry(1, 2, 2, 0x4e), // GPSLatitudeRef = "N" (ASCII, 2 bytes: 'N', NUL — stored inline)
    entry(2, 5, 3, latitudeAt), // GPSLatitude
    Buffer.alloc(4),
  ]);
  return Buffer.concat([Buffer.from("II*\0", "ascii"), Buffer.from([8, 0, 0, 0]), ifd0, gps, make, latitude, pixels]);
}

describe("uploadClientPhoto — TIFF: converted to a JPEG with no metadata, orientation applied (real sharp)", () => {
  it("sends a JPEG: no EXIF/GPS, no marker, 20x40", async () => {
    const original = tiffWithOrientationAndGps();
    const meta = await sharp(original).metadata();
    expect(meta.format).toBe("tiff");
    expect(meta.orientation).toBe(6);
    expect([meta.width, meta.height]).toEqual([40, 20]);
    // The GPS IFD pointer tag (0x8825, little endian) and the Make are really in the bytes.
    expect(original.includes(GPS_IFD_POINTER)).toBe(true);
    expect(original.includes("MARKER-MAKE")).toBe(true);

    const sent = await sendThroughUploadClientPhoto(original, "photo.tif", "image/tiff");

    const out = await sharp(sent).metadata();
    expect(out.format).toBe("jpeg");
    expect(out.exif).toBeUndefined();
    expect(out.orientation).toBeUndefined();
    expect(sent.includes("MARKER-MAKE")).toBe(false);
    expect([out.width, out.height]).toEqual([20, 40]);
  });
});

describe("uploadClientPhoto — a BMP (a format with no EXIF/GPS block) stays accepted and unmodified", () => {
  it("is sent byte for byte", async () => {
    // BITMAPFILEHEADER (14) + BITMAPINFOHEADER (40) + one 24-bit pixel row padded to 4 bytes.
    const bmp = Buffer.alloc(14 + 40 + 4);
    bmp.write("BM", 0, "ascii");
    bmp.writeUInt32LE(bmp.length, 2);
    bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(1, 18);
    bmp.writeInt32LE(1, 22);
    bmp.writeUInt16LE(1, 26);
    bmp.writeUInt16LE(24, 28);
    const sent = await sendThroughUploadClientPhoto(bmp, "photo.bmp", "image/bmp");
    expect(sent.equals(bmp)).toBe(true);
  });
});
