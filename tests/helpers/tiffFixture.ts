// A TIFF of `pages` pages, each IFD carrying `extraTags` more entries than the 9 a
// real 1x1 grayscale page needs (nothing decodes them: they are what makes `metadata()`
// slow). Built at test time, no binary committed. Ported from the generator of the
// second audit of fix/decodage-borne: 100 pages x 4,000 extra tags is 4.8 MB and spent
// 28 s in `metadata()` on Windows, 49 s in the production image.

const REAL_TAGS = 9;

type Entry = [tag: number, type: number, count: number, value: number];

export function tiffWithTags(pages: number, extraTags: number): Buffer {
  const tagCount = REAL_TAGS + extraTags;
  const ifdSize = 2 + tagCount * 12 + 4;
  const pageSize = ifdSize + 2; // the IFD, then one pixel byte (and a pad)
  const out = Buffer.alloc(8 + pages * pageSize);
  out.write("II*\u0000", 0, "latin1");
  out.writeUInt32LE(8, 4);
  for (let page = 0; page < pages; page++) {
    const at = 8 + page * pageSize;
    const pixel = at + ifdSize;
    out.writeUInt16LE(tagCount, at);
    const entries: Entry[] = [
      [256, 3, 1, 1], // width
      [257, 3, 1, 1], // height
      [258, 3, 1, 8], // bits per sample
      [259, 3, 1, 1], // no compression
      [262, 3, 1, 1], // min-is-black
      [273, 4, 1, pixel], // strip offset
      [277, 3, 1, 1], // samples per pixel
      [278, 3, 1, 1], // rows per strip
      [279, 4, 1, 1], // strip byte count
    ];
    for (let k = 0; k < extraTags; k++) entries.push([(40_000 + k) & 0xffff, 3, 1, 0]);
    entries.sort((a, b) => a[0] - b[0]);
    entries.forEach(([tag, type, count, value], k) => {
      const entry = at + 2 + k * 12;
      out.writeUInt16LE(tag, entry);
      out.writeUInt16LE(type, entry + 2);
      out.writeUInt32LE(count, entry + 4);
      if (type === 3) out.writeUInt16LE(value, entry + 8);
      else out.writeUInt32LE(value, entry + 8);
    });
    out.writeUInt32LE(page === pages - 1 ? 0 : at + pageSize, at + 2 + tagCount * 12);
    out[pixel] = 128;
  }
  return out;
}
