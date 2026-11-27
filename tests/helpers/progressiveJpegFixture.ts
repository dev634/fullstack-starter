// A VALID progressive JPEG with as many scans as the spec allows, built byte by byte
// at test time (no binary is committed). Flat image, every coefficient zero, a
// spec-conformant successive-approximation script (no libjpeg warning): it decodes
// without error, which is the point — the cost is only the NUMBER of scans, each
// of which libjpeg consumes inside one native call (`jpeg_start_decompress`) before
// any JS-side timeout can look.
//
// Ported from the generator of the second audit of fix/decodage-borne. With 4
// components and `maxAl` 13 and 6300x6300 pixels it is the file of the audit: 3,529
// scans, ~525 KB, 33.5 s in the production image (one CPU).

type Options = {
  width: number;
  height: number;
  /** 3 (YCbCr-like) or 4 (CMYK): every extra component multiplies the scans. */
  components: number;
  /** Successive-approximation depth: each of the 63 AC coefficients of a component gets maxAl + 1 scans. */
  maxAl: number;
};

/** The marker segment `FF <marker> <length> <body>`. */
function segment(marker: number, body: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff]);
  return Buffer.concat([head, body]);
}

/** Bits written MSB first, with the `FF 00` byte stuffing of entropy-coded data. */
function bitWriter() {
  const bytes: number[] = [];
  let acc = 0;
  let count = 0;
  return {
    put(value: number, length: number): void {
      for (let i = length - 1; i >= 0; i--) {
        acc = (acc << 1) | ((value >> i) & 1);
        count += 1;
        if (count === 8) {
          bytes.push(acc);
          if (acc === 0xff) bytes.push(0);
          acc = 0;
          count = 0;
        }
      }
    },
    flush(): Buffer {
      while (count !== 0) this.put(1, 1);
      return Buffer.from(bytes);
    },
  };
}

/** The scan header (SOS segment) of one component's AC band `k..k`, refinement `ah` -> `al`. */
function acScanHeader(component: number, k: number, ah: number, al: number): Buffer {
  return segment(0xda, Buffer.from([1, component + 1, 0x00, k, k, (ah << 4) | al]));
}

export function progressiveJpegOfScans(options: Options): { buffer: Buffer; scans: number } {
  const { width, height, components, maxAl } = options;
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  parts.push(segment(0xdb, Buffer.from([0x00, ...Array<number>(64).fill(1)])));
  const frame = [8, height >> 8, height & 0xff, width >> 8, width & 0xff, components];
  for (let c = 0; c < components; c++) frame.push(c + 1, 0x11, 0);
  parts.push(segment(0xc2, Buffer.from(frame)));
  // DC table: the single symbol 0 (difference category 0). AC table: the single symbol 0xE0 (EOB14).
  parts.push(segment(0xc4, Buffer.from([0x00, 1, ...Array<number>(15).fill(0), 0x00])));
  parts.push(segment(0xc4, Buffer.from([0x10, 1, ...Array<number>(15).fill(0), 0xe0])));

  const blocks = Math.ceil(width / 8) * Math.ceil(height / 8);
  // First DC scan, interleaved.
  const dcHeader = [components];
  for (let c = 0; c < components; c++) dcHeader.push(c + 1, 0x00);
  dcHeader.push(0, 0, 0x00);
  parts.push(segment(0xda, Buffer.from(dcHeader)));
  const dc = bitWriter();
  for (let i = 0; i < blocks * components; i++) dc.put(0, 1);
  parts.push(dc.flush());

  // The AC scans all carry the same data: runs of EOB over every block.
  const ac = bitWriter();
  let left = blocks;
  while (left > 0) {
    const run = Math.min(left, 32767);
    if (run < 16384) throw new Error(`image too small for this generator (tail run ${run})`);
    ac.put(0, 1);
    ac.put(run - 16384, 14);
    left -= run;
  }
  const acData = ac.flush();

  let scans = 1;
  for (let c = 0; c < components; c++) {
    for (let k = 1; k <= 63; k++) {
      parts.push(acScanHeader(c, k, 0, maxAl), acData);
      scans += 1;
      for (let ah = maxAl; ah >= 1; ah--) {
        parts.push(acScanHeader(c, k, ah, ah - 1), acData);
        scans += 1;
      }
    }
  }
  parts.push(Buffer.from([0xff, 0xd9]));
  return { buffer: Buffer.concat(parts), scans };
}

/** The audit's CMYK file (3,529 scans). */
export function auditProgressiveJpeg(): { buffer: Buffer; scans: number } {
  return progressiveJpegOfScans({ width: 6300, height: 6300, components: 4, maxAl: 13 });
}
