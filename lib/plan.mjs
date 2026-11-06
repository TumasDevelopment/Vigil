// Regole delle planimetrie. Niente dipendenze: le usano azioni, pagine e test.

/** Sotto il limite di 1 MB di nginx e delle azioni di Next, lasciando posto al resto del modulo. */
export const PLAN_MAX_BYTES = 950 * 1024;

const PLAN_MAX_HOSTS = 1000;

/** Il tipo vero dell'immagine, dai primi byte: del nome e del tipo dichiarato non ci si fida. Niente SVG, può contenere script. */
export function sniffImage(bytes) {
  const startsWith = (offset, values) => values.every((value, index) => bytes[offset + index] === value);
  if (startsWith(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(0, [0x52, 0x49, 0x46, 0x46]) && startsWith(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}

const isFraction = (value) => typeof value === "number" && value >= 0 && value <= 1;

/** Legge le posizioni inviate dal modulo. Restituisce null se qualcosa non torna. */
export function parsePositions(text) {
  let items;
  try {
    items = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(items) || items.length > PLAN_MAX_HOSTS) return null;

  const seen = new Set();
  for (const item of items) {
    const hostId = item?.hostId;
    if (!Number.isInteger(hostId) || hostId <= 0 || seen.has(hostId)) return null;
    if (!isFraction(item.x) || !isFraction(item.y)) return null;
    seen.add(hostId);
  }
  return items.map(({ hostId, x, y }) => ({ hostId, x, y }));
}
