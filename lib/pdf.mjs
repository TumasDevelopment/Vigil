// Un PDF scritto a mano, senza librerie: pagine A4, Helvetica e Helvetica-Bold
// (i due font che ogni lettore PDF ha già), testo, rettangoli e linee.
// Le coordinate partono dall'angolo in alto a sinistra, in punti (1/72 di pollice).
import { deflateSync } from "node:zlib";

export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

// Larghezze dei caratteri da 32 a 126, in millesimi della dimensione del font (file AFM di Adobe)
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// I caratteri fuori da Latin-1 che WinAnsiEncoding ha nei codici 128-159, con la loro larghezza
const WIN_ANSI_EXTRA = new Map([
  ["€", [0x80, 556]],
  ["…", [0x85, 1000]],
  ["‘", [0x91, 222]],
  ["’", [0x92, 222]],
  ["“", [0x93, 333]],
  ["”", [0x94, 333]],
  ["•", [0x95, 350]],
  ["–", [0x96, 556]],
  ["—", [0x97, 1000]],
]);
const LATIN1_WIDTHS = new Map([
  [0xa0, 278], [0xb0, 400], [0xb1, 584], [0xb7, 278], [0xd7, 584], [0xab, 556], [0xbb, 556], [0xa9, 737],
]);

/** Il byte WinAnsi del carattere e la sua larghezza; "?" per ciò che il font non ha. */
function encodeChar(char, bold) {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  const code = char.codePointAt(0);
  if (code >= 32 && code <= 126) return [code, table[code - 32]];
  const extra = WIN_ANSI_EXTRA.get(char);
  if (extra) return extra;
  if (code >= 0xa0 && code <= 0xff) {
    if (LATIN1_WIDTHS.has(code)) return [code, LATIN1_WIDTHS.get(code)];
    // Le lettere accentate sono larghe come la lettera di base
    const base = char.normalize("NFD").codePointAt(0);
    return [code, base >= 32 && base <= 126 ? table[base - 32] : 556];
  }
  if (char === "\t") return [32, table[0]];
  return [63, table[63 - 32]];
}

export function textWidth(text, size, bold = false) {
  let total = 0;
  for (const char of String(text)) total += encodeChar(char, bold)[1];
  return (total * size) / 1000;
}

/** Il testo accorciato con "…" finché non sta in `width`. */
export function fitText(text, width, size, bold = false) {
  const value = String(text ?? "");
  if (textWidth(value, size, bold) <= width) return value;
  const chars = [...value];
  while (chars.length > 0 && textWidth(chars.join("") + "…", size, bold) > width) chars.pop();
  return chars.length > 0 ? chars.join("").trimEnd() + "…" : "";
}

/** Righe che stanno in `width`, andando a capo tra le parole. */
export function wrapText(text, width, size, bold = false) {
  const lines = [];
  for (const paragraph of String(text ?? "").split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, bold) > width) {
        lines.push(line);
        line = fitText(word, width, size, bold);
      } else line = textWidth(next, size, bold) > width ? fitText(next, width, size, bold) : next;
    }
    lines.push(line);
  }
  return lines;
}

/** Stringa PDF tra parentesi: ( ) \ con escape, i byte oltre 126 in ottale. */
function pdfString(text, bold) {
  let out = "(";
  for (const char of String(text)) {
    const [code] = encodeChar(char, bold);
    if (code === 40 || code === 41 || code === 92) out += `\\${String.fromCharCode(code)}`;
    else if (code > 126) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(code);
  }
  return `${out})`;
}

const num = (value) => (Math.round(value * 100) / 100).toString();

function rgb(hex) {
  const clean = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ""))?.[1] ?? "000000";
  return [0, 2, 4].map((offset) => num(parseInt(clean.slice(offset, offset + 2), 16) / 255)).join(" ");
}

export class PdfDocument {
  constructor({ title = "", author = "" } = {}) {
    this.title = title;
    this.author = author;
    this.pages = [];
    this.current = null;
  }

  addPage() {
    this.current = [];
    this.pages.push(this.current);
    return this;
  }

  #ops() {
    if (!this.current) this.addPage();
    return this.current;
  }

  text(x, y, value, { size = 10, bold = false, color = "#000000", align = "left", width = 0 } = {}) {
    const content = String(value ?? "");
    if (content === "") return this;
    let left = x;
    if (align !== "left" && width > 0) {
      const used = textWidth(content, size, bold);
      left = align === "right" ? x + width - used : x + (width - used) / 2;
    }
    // y è la linea di base del testo
    this.#ops().push(
      `BT /${bold ? "F2" : "F1"} ${num(size)} Tf ${rgb(color)} rg ${num(left)} ${num(PAGE_HEIGHT - y)} Td ${pdfString(content, bold)} Tj ET`,
    );
    return this;
  }

  rect(x, y, width, height, { fill = null, stroke = null, lineWidth = 0.5 } = {}) {
    if (width <= 0 || height <= 0) return this;
    const box = `${num(x)} ${num(PAGE_HEIGHT - y - height)} ${num(width)} ${num(height)} re`;
    if (fill && stroke) this.#ops().push(`${rgb(fill)} rg ${rgb(stroke)} RG ${num(lineWidth)} w ${box} B`);
    else if (fill) this.#ops().push(`${rgb(fill)} rg ${box} f`);
    else if (stroke) this.#ops().push(`${rgb(stroke)} RG ${num(lineWidth)} w ${box} S`);
    return this;
  }

  line(x1, y1, x2, y2, { color = "#000000", lineWidth = 0.5 } = {}) {
    this.#ops().push(
      `${rgb(color)} RG ${num(lineWidth)} w ${num(x1)} ${num(PAGE_HEIGHT - y1)} m ${num(x2)} ${num(PAGE_HEIGHT - y2)} l S`,
    );
    return this;
  }

  toBuffer(date = new Date()) {
    if (this.pages.length === 0) this.addPage();
    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length;
    };
    const catalog = add(null);
    const pages = add(null);
    const regular = add(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
    const boldFont = add(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"));
    const kids = [];
    for (const ops of this.pages) {
      const stream = deflateSync(Buffer.from(ops.join("\n"), "latin1"));
      const content = add(
        Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from("\nendstream")]),
      );
      kids.push(
        add(
          Buffer.from(
            `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${num(PAGE_WIDTH)} ${num(PAGE_HEIGHT)}] ` +
              `/Resources << /Font << /F1 ${regular} 0 R /F2 ${boldFont} 0 R >> >> /Contents ${content} 0 R >>`,
          ),
        ),
      );
    }
    objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
    objects[pages - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`);
    const stamp = date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const info = add(
      Buffer.from(
        `<< /Title ${pdfString(this.title, false)} /Author ${pdfString(this.author, false)} ` +
          `/Producer (Vigil) /CreationDate (D:${stamp}Z) >>`,
      ),
    );

    const parts = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
    let offset = parts[0].length;
    const offsets = [];
    objects.forEach((body, index) => {
      const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
      offsets.push(offset);
      offset += chunk.length;
      parts.push(chunk);
    });
    const xref =
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
      offsets.map((value) => `${String(value).padStart(10, "0")} 00000 n \n`).join("") +
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
    parts.push(Buffer.from(xref, "latin1"));
    return Buffer.concat(parts);
  }
}
