// CSV come lo scrive e lo legge Excel in italiano: separatore ";" e BOM UTF-8.
// In lettura il separatore si riconosce da solo (";", "," o tabulazione).

const BOM = String.fromCharCode(0xfeff);
const SEPARATORS = [";", ",", "\t"];

/** Il separatore più frequente nella prima riga, fuori dalle virgolette. */
export function detectDelimiter(text) {
  const counts = new Map(SEPARATORS.map((separator) => [separator, 0]));
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && counts.has(char)) counts.set(char, counts.get(char) + 1);
  }
  let best = ";";
  for (const [separator, count] of counts) if (count > counts.get(best)) best = separator;
  return best;
}

/** Righe di celle, RFC 4180: virgolette raddoppiate, a capo dentro le virgolette, CRLF o LF. */
export function parseCsv(input, delimiter) {
  const raw = String(input ?? "");
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  const separator = delimiter ?? detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === separator) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Le righe vuote non contano
  return { delimiter: separator, rows: rows.filter((cells) => cells.some((value) => value.trim() !== "")) };
}

/**
 * Una cella che inizia con = + - @ verrebbe eseguita come formula da Excel:
 * le si mette davanti un apostrofo. I numeri restano numeri.
 */
export function safeCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^[+-]?\d+([.,]\d+)?$/.test(text)) return `'${text}`;
  return text;
}

function quoteCell(text, separator) {
  return /["\r\n]/.test(text) || text.includes(separator) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows, separator = ";") {
  return BOM + rows.map((cells) => cells.map((cell) => quoteCell(safeCell(cell), separator)).join(separator)).join("\r\n") + "\r\n";
}
