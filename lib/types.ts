import type { RangeKey } from "./ranges";
import type { DeviceType, GroupBy, PanelKey, ViewMode } from "./scope";

export type HostStatus = "online" | "unstable" | "offline" | "unreachable" | "maintenance" | "unknown" | "paused";

/** Inizio e fine di una manutenzione, in secondi epoch */
export type MaintenanceSpan = [number, number];

export interface PingerStatus {
  /** Secondi epoch dell'ultimo ciclo completato */
  lastBeat: number | null;
  healthy: boolean;
}

export interface HostSummary {
  id: number;
  name: string;
  address: string;
  sector: string;
  type: DeviceType;
  enabled: boolean;
  status: HostStatus;
  since: number | null;
  lastCheck: number | null;
  rtt: number | null;
  loss: number | null;
  /** Perché risulta instabile, in parole */
  reason: string | null;
  pingEnabled: boolean;
  /** Soglie in vigore, già risolte tra host e tipo */
  latencyWarn: number | null;
  lossWarn: number | null;
  serviceCount: number;
  /** Fine della manutenzione in corso */
  maintenanceUntil: number | null;
  /** Il dispositivo a monte, solo se l'utente lo può vedere */
  parentId: number | null;
  parentName: string | null;
}

export interface HostRow extends HostSummary {
  uptime: number | null;
  avgRtt: number | null;
  lossRange: number | null;
  /** Latenza media per intervallo, allineata a OverviewData.t */
  lat: (number | null)[];
  /** Quota di cicli riusciti per intervallo, da 0 a 1 */
  up: (number | null)[];
  maintenance: MaintenanceSpan[];
}

export interface OutageRow {
  id: number;
  hostId: number;
  hostName: string;
  address: string;
  sector: string;
  type: DeviceType;
  started: number;
  ended: number | null;
  /** Nome del servizio, se l'interruzione non riguarda l'intero host */
  service: string | null;
  /** Il dispositivo a monte che l'ha causata, solo se l'utente lo può vedere */
  causeName: string | null;
  /** È iniziata durante una manutenzione: non conta nella disponibilità */
  inMaintenance: boolean;
  ackBy: string | null;
  ackAt: number | null;
  note: string;
}

export interface MaintenanceWindow {
  id: number;
  hostId: number | null;
  hostName: string | null;
  sector: string | null;
  starts: number;
  ends: number;
  reason: string;
  createdBy: string;
  /** Host coperti, compresi quelli collegati a valle */
  covered: number;
  state: "scheduled" | "running" | "done";
}

export interface PlanMarker {
  hostId: number;
  name: string;
  address: string;
  status: HostStatus;
  reason: string | null;
  /** Frazioni dell'immagine, da 0 a 1 */
  x: number;
  y: number;
}

export interface FloorPlan {
  id: number;
  name: string;
  version: number;
  markers: PlanMarker[];
}

export interface DiscoveryItem {
  address: string;
  name: string | null;
  /** Null se non ha risposto al ping */
  rtt: number | null;
  ports: number[];
  mac: string | null;
  vendor: string | null;
  type: string;
  /** L'host già registrato con questo indirizzo o nome */
  known: { id: number; name: string } | null;
}

export interface DiscoveryScan {
  id: number;
  subnet: string;
  status: "queued" | "running" | "done" | "failed";
  total: number;
  checked: number;
  error: string;
  createdBy: string;
  created: number;
  found: DiscoveryItem[];
}

export type ServiceKind = "tcp" | "http" | "cert";
export type ServiceStatus = "unknown" | "ok" | "warn" | "failed";

export interface ServiceRow {
  id: number;
  hostId: number;
  hostName: string;
  address: string;
  sector: string;
  type: DeviceType;
  paused: boolean;
  name: string;
  kind: ServiceKind;
  port: number | null;
  url: string | null;
  warnDays: number;
  status: ServiceStatus;
  since: number | null;
  lastCheck: number | null;
  ms: number | null;
  detail: string;
}

export interface ServicesData {
  serverTime: number;
  pinger: PingerStatus;
  services: ServiceRow[];
}

export interface ServerProcess {
  name: string;
  status: string;
  restarts: number;
  startedAt: number | null;
  cpu: number;
  memory: number;
}

export interface ServerPort {
  port: number;
  upstream: number;
  code: number | null;
  ok: boolean;
  detail: string;
}

export interface ServerSnapshot {
  cpu: number | null;
  cores: number;
  load: number[];
  uptime: number;
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  swapTotal: number;
  diskUsed: number;
  diskTotal: number;
  processes: ServerProcess[] | null;
  nginxReadable: boolean;
  ports: ServerPort[];
}

export interface ServerData {
  range: RangeKey;
  serverTime: number;
  sampledAt: number | null;
  /** L'ultimo campione è troppo vecchio per essere attendibile */
  stale: boolean;
  current: ServerSnapshot | null;
  t: number[];
  cpu: (number | null)[];
  mem: (number | null)[];
  swap: (number | null)[];
  disk: (number | null)[];
}

export interface Alert {
  id: number;
  ts: number;
  hostId: number | null;
  level: "problem" | "warning" | "resolved";
  title: string;
  body: string;
}

export interface AlertDevice {
  id: number;
  name: string;
  createdAt: number;
  lastSeen: number | null;
}

export interface Profile {
  id: number;
  name: string;
  shared: boolean;
  canEdit: boolean;
  sectors: string[];
  types: DeviceType[];
  hostIds: number[];
  view: ViewMode;
  groupBy: GroupBy;
  range: RangeKey;
  panels: PanelKey[];
}

export interface OverviewData {
  range: RangeKey;
  serverTime: number;
  bucketSeconds: number;
  pinger: PingerStatus;
  t: number[];
  hosts: HostRow[];
  outages: OutageRow[];
  /** L'utente vede solo una parte degli host */
  restricted: boolean;
}

export interface HostDetailData {
  range: RangeKey;
  serverTime: number;
  bucketSeconds: number;
  pinger: PingerStatus;
  host: HostSummary;
  stats: {
    uptime: number | null;
    avgRtt: number | null;
    minRtt: number | null;
    maxRtt: number | null;
    p95Rtt: number | null;
    loss: number | null;
    outageCount: number;
    downtimeSeconds: number;
  };
  t: number[];
  avg: (number | null)[];
  min: (number | null)[];
  max: (number | null)[];
  lossSeries: (number | null)[];
  up: (number | null)[];
  maintenance: MaintenanceSpan[];
  outages: OutageRow[];
  services: ServiceRow[];
}

export interface EventsData {
  range: RangeKey;
  serverTime: number;
  pinger: PingerStatus;
  outages: OutageRow[];
}

export interface LongOfflineHost {
  id: number;
  name: string;
  address: string;
  sector: string;
  since: number;
  /** Quanti dispositivi dell'utente sono giù per colpa di questo */
  dependents: number;
  ackBy: string | null;
}

export interface LongOfflineFeed {
  hosts: LongOfflineHost[];
  serverTime: number;
}
