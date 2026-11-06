export const REFRESH_SECONDS = 10;

export const RANGE_KEYS = ["15m", "1h", "6h", "24h", "7d"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

// `ttl`: per quanti secondi lo storico aggregato si può riusare. Lo stato attuale
// degli host è sempre fresco; solo i grafici dei periodi lunghi vengono ricalcolati
// meno spesso, perché 7 giorni di dati ogni 10 secondi peserebbero sul server.
export const RANGES: Record<RangeKey, { label: string; recent: string; seconds: number; bucket: number; ttl: number }> = {
  "15m": { label: "15 min", recent: "Ultimi 15 min", seconds: 900, bucket: 10, ttl: 5 },
  "1h": { label: "1 ora", recent: "Ultima ora", seconds: 3600, bucket: 30, ttl: 8 },
  "6h": { label: "6 ore", recent: "Ultime 6 ore", seconds: 21600, bucket: 180, ttl: 30 },
  "24h": { label: "24 ore", recent: "Ultime 24 ore", seconds: 86400, bucket: 600, ttl: 60 },
  "7d": { label: "7 giorni", recent: "Ultimi 7 giorni", seconds: 604800, bucket: 3600, ttl: 300 },
};

export const DEFAULT_RANGE: RangeKey = "1h";

export function parseRange(value: unknown): RangeKey {
  return RANGE_KEYS.includes(value as RangeKey) ? (value as RangeKey) : DEFAULT_RANGE;
}
