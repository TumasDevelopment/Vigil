// Aiuti comuni alle azioni dei moduli. Stanno fuori dai file "use server", che possono
// esportare solo funzioni asincrone.

export const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
export const isUniqueViolation = (error: unknown) => (error as { code?: string }).code === "23505";
export const isForeignKeyViolation = (error: unknown) => (error as { code?: string }).code === "23503";
export const isRowId = (value: number) => Number.isInteger(value) && value > 0 && value <= 2_147_483_647;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Data facoltativa AAAA-MM-GG. Vuota: null. Non valida: undefined. */
export function parseDay(value: string) {
  if (!value) return null;
  if (!DATE_PATTERN.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? undefined : value;
}

/** I campi dell'inventario, con i limiti dello schema. Vuoti diventano null. */
export const INVENTORY_FIELDS = [
  { key: "manufacturer", column: "manufacturer", label: "Il produttore", max: 80 },
  { key: "model", column: "model", label: "Il modello", max: 80 },
  { key: "serial", column: "serial", label: "Il numero di serie", max: 80 },
  { key: "firmware", column: "firmware", label: "Il firmware", max: 80 },
  { key: "location", column: "location", label: "La posizione", max: 120 },
  { key: "owner", column: "owner", label: "Il responsabile", max: 80 },
  { key: "inventoryNote", column: "inventory_note", label: "La nota", max: 500 },
] as const;

export type InventoryKey = (typeof INVENTORY_FIELDS)[number]["key"];
