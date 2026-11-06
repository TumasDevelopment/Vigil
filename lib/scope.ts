// Regole di settori, tipi e profili. Niente dipendenze: le usano pagine, azioni e test.

export const DEVICE_TYPES = [
  { key: "server", label: "Server" },
  { key: "storage", label: "NAS e storage" },
  { key: "switch", label: "Switch" },
  { key: "router", label: "Router e firewall" },
  { key: "wifi", label: "Access point" },
  { key: "pc", label: "PC e postazioni" },
  { key: "stampante", label: "Stampanti" },
  { key: "telecamera", label: "Telecamere" },
  { key: "macchina", label: "Macchine e PLC" },
  { key: "altro", label: "Altro" },
] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number]["key"];

export const VIEWS = [
  { key: "summary", label: "Riepilogo" },
  { key: "cards", label: "Schede" },
  { key: "table", label: "Tabella" },
  { key: "wall", label: "Parete" },
] as const;
export type ViewMode = (typeof VIEWS)[number]["key"];

export const GROUPINGS = [
  { key: "none", label: "Nessuno" },
  { key: "sector", label: "Settore" },
  { key: "type", label: "Tipo" },
] as const;
export type GroupBy = (typeof GROUPINGS)[number]["key"];

export const PANELS = [
  { key: "tiles", label: "Riquadri riassuntivi" },
  { key: "hosts", label: "Host" },
  { key: "latency", label: "Grafico latenza" },
  { key: "outages", label: "Ultime interruzioni" },
  { key: "timeline", label: "Timeline di stato" },
] as const;
export type PanelKey = (typeof PANELS)[number]["key"];
export const ALL_PANELS: PanelKey[] = PANELS.map((panel) => panel.key);

export const isDeviceType = (value: unknown): value is DeviceType => DEVICE_TYPES.some((item) => item.key === value);
export const isViewMode = (value: unknown): value is ViewMode => VIEWS.some((item) => item.key === value);
export const isGroupBy = (value: unknown): value is GroupBy => GROUPINGS.some((item) => item.key === value);
export const isPanel = (value: unknown): value is PanelKey => PANELS.some((item) => item.key === value);

export function deviceLabel(type: DeviceType) {
  return DEVICE_TYPES.find((item) => item.key === type)?.label ?? "Altro";
}

const TYPE_ALIASES: Record<string, DeviceType> = {
  nas: "storage",
  firewall: "router",
  router: "router",
  ap: "wifi",
  "access-point": "wifi",
  wifi: "wifi",
  "wi-fi": "wifi",
  pc: "pc",
  postazione: "pc",
  stampante: "stampante",
  telecamera: "telecamera",
  macchina: "macchina",
  plc: "macchina",
};

/** Per l'importazione: accetta la chiave, l'etichetta o un sinonimo comune. */
export function parseDeviceType(text: string): DeviceType | null {
  const needle = text.trim().toLowerCase();
  const match = DEVICE_TYPES.find((item) => item.key === needle || item.label.toLowerCase() === needle);
  return match?.key ?? TYPE_ALIASES[needle] ?? null;
}

/** Valore del filtro "tutti": la stringa vuota indica gli host senza settore. */
export const ALL_FILTER = "__tutti";
export const NO_SECTOR_LABEL = "Senza settore";

export interface HostScope {
  sectors: string[];
  types: DeviceType[];
  hostIds: number[];
}

/**
 * Settori e tipi si combinano: "Produzione" + "Stampanti" sono le stampanti di
 * Produzione. Gli host scelti a mano si aggiungono sempre. Nessuna scelta: tutti.
 */
export function inScope(host: { id: number; sector: string; type: DeviceType }, scope: HostScope) {
  const { sectors, types, hostIds } = scope;
  const hasFilter = sectors.length > 0 || types.length > 0;
  if (!hasFilter && hostIds.length === 0) return true;
  if (hostIds.includes(host.id)) return true;
  return (
    hasFilter &&
    (sectors.length === 0 || sectors.includes(host.sector)) &&
    (types.length === 0 || types.includes(host.type))
  );
}

/** Gli host di un account limitato. A differenza di inScope, nessuna scelta significa nessun host. */
export function inAccount(host: { id: number; sector: string }, account: { sectors: string[]; hostIds: number[] }) {
  return account.sectors.includes(host.sector) || account.hostIds.includes(host.id);
}

export function describeScope(scope: HostScope) {
  const parts: string[] = [];
  if (scope.sectors.length > 0) parts.push(scope.sectors.map((name) => name || NO_SECTOR_LABEL).join(", "));
  if (scope.types.length > 0) parts.push(scope.types.map(deviceLabel).join(", "));
  if (scope.hostIds.length > 0) {
    parts.push(scope.hostIds.length === 1 ? "1 host scelto" : `${scope.hostIds.length} host scelti`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Tutti gli host";
}

export interface HostGroup<T> {
  key: string;
  label: string;
  hosts: T[];
}

/** I gruppi hanno un ordine fisso, così restano al loro posto a ogni aggiornamento. */
export function groupHosts<T extends { sector: string; type: DeviceType }>(hosts: T[], by: GroupBy): HostGroup<T>[] {
  if (by === "none") return [{ key: "all", label: "", hosts }];

  const buckets = new Map<string, T[]>();
  for (const host of hosts) {
    const key = by === "sector" ? host.sector : host.type;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(host);
    else buckets.set(key, [host]);
  }

  if (by === "type") {
    return DEVICE_TYPES.filter((item) => buckets.has(item.key)).map((item) => ({
      key: item.key,
      label: item.label,
      hosts: buckets.get(item.key) as T[],
    }));
  }

  return [...buckets.entries()]
    .map(([key, list]) => ({ key, label: key || NO_SECTOR_LABEL, hosts: list }))
    .sort((a, b) => {
      if (!a.key !== !b.key) return a.key ? -1 : 1; // "Senza settore" va in fondo
      return a.label.localeCompare(b.label, "it");
    });
}

/** Chi è in manutenzione è fuori dai conteggi come chi è in pausa, ma si dice quanti sono. */
export function countStatus(hosts: { status: string }[]) {
  const counts = { monitored: 0, online: 0, unstable: 0, offline: 0, unreachable: 0, unknown: 0, maintenance: 0 };
  for (const { status } of hosts) {
    if (status === "paused") continue;
    if (status === "maintenance") {
      counts.maintenance++;
      continue;
    }
    counts.monitored++;
    if (status === "online" || status === "unstable" || status === "offline" || status === "unreachable") {
      counts[status]++;
    } else counts.unknown++;
  }
  return counts;
}

/** I secondi di [from, to] coperti da almeno una finestra: due finestre sovrapposte non contano doppio. */
export function overlapSeconds(from: number, to: number, spans: [number, number][]) {
  let total = 0;
  let reached = from;
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const begin = Math.max(start, reached);
    const stop = Math.min(end, to);
    if (stop > begin) {
      total += stop - begin;
      reached = stop;
    }
  }
  return total;
}

export function mean(values: (number | null)[]) {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

/** Media punto per punto di più serie: gli intervalli senza dati non contano. */
export function meanSeries(series: (number | null)[][], length: number) {
  return Array.from({ length }, (_, index) => mean(series.map((values) => values[index] ?? null)));
}
