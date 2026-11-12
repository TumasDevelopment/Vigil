// Le colonne del CSV degli host: l'export le scrive con queste intestazioni,
// l'import le riconosce anche in inglese e con piccole varianti.
import { parseDay } from "./form";

export const HOST_COLUMNS = [
  { key: "name", header: "Nome", aliases: ["name", "nome host", "hostname"] },
  { key: "address", header: "Indirizzo", aliases: ["address", "ip", "indirizzo ip", "ip address", "host"] },
  { key: "sector", header: "Settore", aliases: ["sector", "gruppo", "group"] },
  { key: "type", header: "Tipo", aliases: ["type", "tipo dispositivo", "device type"] },
  { key: "ping", header: "Ping", aliases: ["ping attivo"] },
  { key: "parent", header: "Collegato a", aliases: ["parent", "padre", "uplink", "dipende da", "collegato"] },
  { key: "critical", header: "Critico", aliases: ["critical", "critica"] },
  { key: "publicLabel", header: "Nome pubblico", aliases: ["public label", "public name", "nome stato"] },
  { key: "latencyWarn", header: "Soglia latenza (ms)", aliases: ["soglia latenza", "latency warn", "latenza"] },
  { key: "lossWarn", header: "Soglia perdita (%)", aliases: ["soglia perdita", "loss warn", "perdita"] },
  { key: "manufacturer", header: "Produttore", aliases: ["manufacturer", "marca", "vendor", "brand"] },
  { key: "model", header: "Modello", aliases: ["model"] },
  { key: "serial", header: "Numero di serie", aliases: ["serial", "seriale", "serial number", "s n", "sn"] },
  { key: "firmware", header: "Firmware", aliases: ["versione firmware", "firmware version"] },
  { key: "location", header: "Posizione", aliases: ["location", "ubicazione"] },
  { key: "owner", header: "Responsabile", aliases: ["owner", "referente"] },
  {
    key: "purchasedOn",
    header: "Data di acquisto",
    aliases: ["acquisto", "acquistato il", "purchased", "purchased on", "purchase date"],
  },
  { key: "warrantyUntil", header: "Fine garanzia", aliases: ["garanzia", "warranty", "warranty until", "warranty end"] },
  { key: "inventoryNote", header: "Note", aliases: ["nota", "note", "notes", "inventory note"] },
] as const;

export type HostColumn = (typeof HOST_COLUMNS)[number]["key"];

/** Minuscole, senza accenti, senza unità tra parentesi e senza segni: "Soglia latenza (ms)" → "soglia latenza". */
export function headerKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LOOKUP = new Map<string, HostColumn>();
for (const column of HOST_COLUMNS) {
  LOOKUP.set(headerKey(column.header), column.key);
  LOOKUP.set(headerKey(column.key), column.key);
  for (const alias of column.aliases) LOOKUP.set(headerKey(alias), column.key);
}

/** Per ogni cella dell'intestazione, la colonna riconosciuta oppure null. */
export const mapHeader = (cells: string[]) => cells.map((cell) => LOOKUP.get(headerKey(cell)) ?? null);

/** Toglie l'apostrofo che l'export mette davanti a ciò che Excel scambierebbe per una formula. */
export const cleanCell = (value: string) => {
  const text = value.trim();
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
};

const YES = new Set(["si", "sì", "s", "yes", "y", "true", "vero", "1", "x"]);
const NO = new Set(["no", "n", "false", "falso", "0"]);

/** Sì o no. Vuoto: null. Non riconosciuto: undefined. */
export function parseFlag(value: string) {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (YES.has(text)) return true;
  if (NO.has(text)) return false;
  return undefined;
}

/** Data come AAAA-MM-GG oppure GG/MM/AAAA (anche con - o .). Vuota: null. Non valida: undefined. */
export function parseCsvDate(value: string) {
  const text = value.trim();
  if (!text) return null;
  const italian = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (italian) return parseDay(`${italian[3]}-${italian[2].padStart(2, "0")}-${italian[1].padStart(2, "0")}`);
  return parseDay(text.slice(0, 10));
}

export interface ImportRow {
  line: number;
  name: string;
  address: string;
  action: "create" | "update" | "skip" | "error";
  note: string;
}

export interface ImportPreview {
  rows: ImportRow[];
  counts: Record<ImportRow["action"], number>;
  /** Intestazioni riconosciute, nel nome usato dall'export. */
  columns: string[];
  /** Intestazioni del file che non corrispondono a nessuna colonna. */
  ignored: string[];
  mode: "new" | "update";
  applied: boolean;
}
