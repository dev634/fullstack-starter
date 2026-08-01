// Render a markdown doc to PDF. Pure JS (pdfkit) — no headless browser.
//
//   node scripts/build-docs-pdf.mjs [source.md] [output.pdf] [title] [subtitle]
//
// Defaults to the main documentation, so `npm run docs:pdf` keeps working;
// other docs pass their own arguments rather than copying this script.
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const [srcArg, outArg, titleArg, subtitleArg] = process.argv.slice(2);
const SRC = path.resolve(REPO, srcArg ?? "docs/DOCUMENTATION.md");
const OUT = path.resolve(REPO, outArg ?? "docs/DOCUMENTATION.pdf");

const BRAND = "Devadn";
const TITLE = titleArg ?? "Documentation";
const SUBTITLE = subtitleArg ?? "Gestion d'entreprises, projets et chantiers photovoltaïques";

// ---- palette ----
const C = { text: "#111827", muted: "#6b7280", primary: "#2563eb", rule: "#d1d5db", codeBg: "#f3f4f6", codeText: "#1f2937" };
const MARGIN = 60;

// ---- markdown → blocks ----
function parse(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0, para = [];
  const flush = () => { if (para.length) { blocks.push({ type: "p", text: para.join(" ") }); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flush(); i++; const code = [];
      while (i < lines.length && !lines[i].startsWith("```")) { code.push(lines[i]); i++; }
      i++; blocks.push({ type: "code", text: code.join("\n") }); continue;
    }
    if (/^#\s/.test(line)) { flush(); blocks.push({ type: "h1", text: line.slice(2).trim() }); i++; continue; }
    if (/^##\s/.test(line)) { flush(); blocks.push({ type: "h2", text: line.slice(3).trim() }); i++; continue; }
    if (/^###\s/.test(line)) { flush(); blocks.push({ type: "h3", text: line.slice(4).trim() }); i++; continue; }
    const img = line.match(/^!\[(.*)\]\(([^)]+)\)\s*$/);
    if (img) { flush(); blocks.push({ type: "img", caption: img[1], src: img[2] }); i++; continue; }
    const ol = line.match(/^(\d+)\.\s+(.*)$/);
    if (ol) { flush(); blocks.push({ type: "li", ordinal: ol[1] + ".", text: ol[2] }); i++; continue; }
    if (/^[-*]\s+/.test(line)) { flush(); blocks.push({ type: "li", ordinal: null, text: line.replace(/^[-*]\s+/, "") }); i++; continue; }
    if (line.trim() === "") { flush(); i++; continue; }
    para.push(line.trim()); i++;
  }
  flush();
  return blocks;
}

// split inline **bold** and `code` into runs
function runs(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: text.slice(last, m.index), s: "n" });
    const tok = m[0];
    if (tok.startsWith("**")) out.push({ t: tok.slice(2, -2), s: "b" });
    else out.push({ t: tok.slice(1, -1), s: "c" });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ t: text.slice(last), s: "n" });
  return out;
}

const doc = new PDFDocument({ size: "A4", margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }, bufferPages: true, autoFirstPage: false });
doc.registerFont("body", "Helvetica");
doc.registerFont("bold", "Helvetica-Bold");
doc.registerFont("obl", "Helvetica-Oblique");
doc.registerFont("mono", "Courier");

const A4W = 595.28, A4H = 841.89;
const CONTENT_W = A4W - MARGIN * 2;
const BOTTOM = A4H - MARGIN;
const cur = () => doc.bufferedPageRange().count - 1;

function renderRuns(list, x, width, opts = {}) {
  list.forEach((r, idx) => {
    const isLast = idx === list.length - 1;
    if (r.s === "b") doc.font("bold").fillColor(C.text);
    else if (r.s === "c") doc.font("mono").fillColor(C.primary);
    else doc.font("body").fillColor(opts.color || C.text);
    const o = { width, continued: !isLast, align: opts.align || "left" };
    if (idx === 0) doc.text(r.t, x, opts.y != null ? opts.y : doc.y, o);
    else doc.text(r.t, o);
  });
}

function ensure(h) { if (doc.y + h > BOTTOM) doc.addPage(); }

// Read a PNG's pixel dimensions from its IHDR chunk (bytes 16–23).
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// ---------- COVER ----------
doc.addPage();
doc.rect(0, 0, A4W, 12).fill(C.primary);
doc.fillColor(C.primary).font("bold").fontSize(13).text(BRAND.toUpperCase(), MARGIN, 120, { characterSpacing: 2 });
doc.fillColor(C.text).font("bold").fontSize(40).text(TITLE, MARGIN, 210, { width: CONTENT_W });
doc.fillColor(C.muted).font("body").fontSize(15).text(SUBTITLE, MARGIN, doc.y + 10, { width: CONTENT_W });
doc.moveTo(MARGIN, 340).lineTo(A4W - MARGIN, 340).lineWidth(2).stroke(C.primary);
const today = new Date().toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
doc.fillColor(C.muted).font("body").fontSize(11).text("De l'installation à l'utilisation", MARGIN, 360);
doc.text(today, MARGIN, A4H - 120);

// ---------- TABLE OF CONTENTS ----------
doc.addPage();
doc.fillColor(C.text).font("bold").fontSize(22).text("Sommaire", MARGIN, MARGIN);
doc.moveDown(1);
const blocks = parse(fs.readFileSync(SRC, "utf8"));
const tocEntries = blocks.filter((b) => b.type === "h1" || b.type === "h2").map((b) => ({ ...b, pageNo: null, tocPage: null, tocY: null }));
let chapNo = 0;
for (const e of tocEntries) {
  if (doc.y + 20 > BOTTOM) doc.addPage();
  const y = doc.y;
  if (e.type === "h1") {
    chapNo++;
    doc.font("bold").fontSize(11.5).fillColor(C.text).text(`${chapNo}.  ${e.text}`, MARGIN, y, { width: CONTENT_W - 40 });
  } else {
    doc.font("body").fontSize(10.5).fillColor(C.muted).text(e.text, MARGIN + 22, y, { width: CONTENT_W - 62 });
  }
  e.tocPage = cur();
  e.tocY = y;
  doc.moveDown(0.55);
}

// ---------- CONTENT ----------
doc.addPage();
let ti = 0;
let curChapterOutline = null;
let chapCount = 0;
for (const b of blocks) {
  if (b.type === "h1") {
    if (doc.y > MARGIN + 4) doc.addPage();
    chapCount++;
    tocEntries[ti++].pageNo = cur();
    curChapterOutline = doc.outline.addItem(`${chapCount}. ${b.text}`);
    doc.fillColor(C.primary).font("bold").fontSize(12).text(`CHAPITRE ${chapCount}`, MARGIN, doc.y, { characterSpacing: 1 });
    doc.fillColor(C.text).font("bold").fontSize(24).text(b.text, MARGIN, doc.y + 2, { width: CONTENT_W });
    doc.moveTo(MARGIN, doc.y + 6).lineTo(A4W - MARGIN, doc.y + 6).lineWidth(1.5).stroke(C.primary);
    doc.moveDown(1.2);
  } else if (b.type === "h2") {
    ensure(40);
    tocEntries[ti++].pageNo = cur();
    if (curChapterOutline) curChapterOutline.addItem(b.text);
    doc.moveDown(0.4);
    doc.fillColor(C.text).font("bold").fontSize(14.5).text(b.text, MARGIN, doc.y, { width: CONTENT_W });
    doc.moveDown(0.35);
  } else if (b.type === "h3") {
    ensure(28);
    doc.moveDown(0.2);
    doc.fillColor(C.primary).font("bold").fontSize(11.5).text(b.text, MARGIN, doc.y, { width: CONTENT_W });
    doc.moveDown(0.25);
  } else if (b.type === "p") {
    ensure(24);
    doc.fontSize(10.5);
    renderRuns(runs(b.text), MARGIN, CONTENT_W, { color: C.text });
    doc.moveDown(0.7);
  } else if (b.type === "li") {
    ensure(22);
    doc.fontSize(10.5);
    const y0 = doc.y;
    doc.font("bold").fillColor(C.primary).text(b.ordinal ? b.ordinal : "•", MARGIN + 4, y0, { width: 16 });
    doc.y = y0;
    renderRuns(runs(b.text), MARGIN + 24, CONTENT_W - 24, { y: y0, color: C.text });
    doc.moveDown(0.45);
  } else if (b.type === "img") {
    const file = path.join(REPO, "docs", b.src);
    if (fs.existsSync(file)) {
      const { w, h } = pngSize(file);
      let iw = CONTENT_W, ih = (CONTENT_W * h) / w;
      const MAXH = 360;
      if (ih > MAXH) { ih = MAXH; iw = (MAXH * w) / h; }
      const capH = b.caption ? 16 : 0;
      if (doc.y + ih + capH + 10 > BOTTOM) doc.addPage();
      const x = MARGIN + (CONTENT_W - iw) / 2;
      const top = doc.y + 4;
      doc.image(file, x, top, { width: iw, height: ih });
      doc.lineWidth(0.5).strokeColor(C.rule).rect(x, top, iw, ih).stroke();
      doc.y = top + ih + 3;
      if (b.caption) {
        doc.font("obl").fontSize(8.5).fillColor(C.muted).text(b.caption, MARGIN, doc.y, { width: CONTENT_W, align: "center" });
      }
      doc.moveDown(0.9);
    }
  } else if (b.type === "code") {
    const lines = b.text.split("\n");
    doc.fontSize(9);
    const lh = 12.5, pad = 8;
    const boxH = lines.length * lh + pad * 2;
    if (doc.y + boxH > BOTTOM) doc.addPage();
    const top = doc.y;
    doc.roundedRect(MARGIN, top, CONTENT_W, boxH, 4).fill(C.codeBg);
    doc.fillColor(C.codeText).font("mono");
    lines.forEach((ln, k) => doc.text(ln || " ", MARGIN + pad, top + pad + k * lh, { width: CONTENT_W - pad * 2, lineBreak: false }));
    doc.y = top + boxH;
    doc.moveDown(0.7);
  }
}

// ---------- BACKFILL TOC PAGE NUMBERS ----------
const N = doc.bufferedPageRange().count;
for (const e of tocEntries) {
  if (e.pageNo == null) continue;
  doc.switchToPage(e.tocPage);
  doc.font(e.type === "h1" ? "bold" : "body").fontSize(e.type === "h1" ? 11.5 : 10.5).fillColor(e.type === "h1" ? C.text : C.muted);
  doc.text(String(e.pageNo + 1), A4W - MARGIN - 40, e.tocY, { width: 40, align: "right", lineBreak: false });
}

// ---------- HEADER + FOOTER on every page except the cover ----------
// Zero this page's vertical margins first: stamping at the very top/bottom
// otherwise triggers pdfkit's overflow auto-pagination and adds blank pages.
for (let p = 1; p < N; p++) {
  doc.switchToPage(p);
  doc.page.margins.top = 0;
  doc.page.margins.bottom = 0;
  doc.font("bold").fontSize(8).fillColor(C.muted).text(BRAND, MARGIN, 30, { width: CONTENT_W / 2, characterSpacing: 1, lineBreak: false });
  doc.font("body").fontSize(8).fillColor(C.muted).text(TITLE, A4W / 2, 30, { width: CONTENT_W / 2, align: "right", lineBreak: false });
  doc.moveTo(MARGIN, 44).lineTo(A4W - MARGIN, 44).lineWidth(0.5).stroke(C.rule);
  doc.moveTo(MARGIN, A4H - 42).lineTo(A4W - MARGIN, A4H - 42).lineWidth(0.5).stroke(C.rule);
  doc.font("body").fontSize(8).fillColor(C.muted).text(SUBTITLE, MARGIN, A4H - 36, { width: CONTENT_W / 2, lineBreak: false });
  doc.text(`Page ${p + 1} / ${N}`, A4W / 2, A4H - 36, { width: CONTENT_W / 2, align: "right", lineBreak: false });
}

doc.flushPages();
const stream = fs.createWriteStream(OUT);
doc.pipe(stream);
doc.end();
stream.on("finish", () => console.log(`PDF written: ${OUT} (${N} pages, ${fs.statSync(OUT).size} bytes)`));
