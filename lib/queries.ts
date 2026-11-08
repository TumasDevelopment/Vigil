import "server-only";
import type { SessionUser } from "./auth";
import { db } from "./db";
import { healthProblems } from "./health";
import { parseRange, RANGES, type RangeKey } from "./ranges";
import {
  inAccount,
  isDeviceType,
  isGroupBy,
  isPanel,
  isViewMode,
  overlapSeconds,
  type DeviceType,
  type GroupBy,
  type ViewMode,
} from "./scope";
import type {
  LongOfflineFeed,
  Alert,
  AlertDevice,
  EventsData,
  FloorPlan,
  HostDetailData,
  HostRow,
  HostStatus,
  HostSummary,
  MaintenanceSpan,
  DiscoveryItem,
  DiscoveryScan,
  MaintenanceWindow,
  OutageRow,
  OverviewData,
  PingerStatus,
  Profile,
  ServerData,
  ServerSnapshot,
  ServiceKind,
  ServiceRow,
  ServicesData,
  ServiceStatus,
  SystemFacts,
} from "./types";

// Oltre questo ritardo un dato non è più attendibile: meglio "Nessun dato" che un falso "Online"
const STALE_AFTER_SECONDS = 35;
const SERVICE_STALE_SECONDS = 120;
const CERT_STALE_SECONDS = 7500;
const SERVER_STALE_SECONDS = 180;
const SERVER_BUCKET_SECONDS = 60;
const ALERT_PAGE = 50;

const nowSeconds = () => Date.now() / 1000;
const OFFLINE_POPUP_SECONDS = 120;

function bucketAxis(range: RangeKey) {
  const { seconds, bucket } = RANGES[range];
  const last = Math.floor(nowSeconds() / bucket) * bucket;
  const count = Math.round(seconds / bucket);
  const first = last - (count - 1) * bucket;
  return { first, t: Array.from({ length: count }, (_, index) => first + index * bucket) };
}

interface StateRow {
  id: number;
  name: string;
  address: string;
  group_name: string;
  device_type: DeviceType;
  enabled: boolean;
  status: "unknown" | "online" | "offline" | null;
  since: number | null;
  last_check: number | null;
  last_rtt: number | null;
  last_loss: number | null;
  fail_streak: number | null;
  ping_enabled: boolean;
  rtt_1m: number | null;
  loss_1m: number | null;
  latency_warn: number | null;
  loss_warn: number | null;
  service_count: number;
  failed_services: string[];
  parent_id: number | null;
  parent_name: string | null;
  cause_host_id: number | null;
  cause_name: string | null;
  maintenance_until: number | null;
  maintenance_reason: string | null;
}

const HOST_SELECT = `
  WITH active AS (
    SELECT DISTINCT ON (host_id) host_id, ends_at, reason
    FROM maintenance_hosts
    WHERE starts_at <= now() AND ends_at > now()
    ORDER BY host_id, ends_at DESC
  )
  SELECT h.id, h.name, h.address, h.group_name, h.device_type, h.enabled, h.ping_enabled, s.status,
         extract(epoch FROM s.since)::float8 AS since,
         extract(epoch FROM s.last_check)::float8 AS last_check,
         s.last_rtt::float8 AS last_rtt, s.last_loss::float8 AS last_loss, s.fail_streak,
         s.rtt_1m::float8 AS rtt_1m, s.loss_1m::float8 AS loss_1m,
         coalesce(h.latency_warn_ms, t.latency_warn_ms) AS latency_warn,
         coalesce(h.loss_warn_pct, t.loss_warn_pct) AS loss_warn,
         coalesce(sv.total, 0) AS service_count,
         coalesce(sv.failed, '{}') AS failed_services,
         h.parent_id, ph.name AS parent_name, o.cause_host_id, ch.name AS cause_name,
         extract(epoch FROM a.ends_at)::float8 AS maintenance_until, a.reason AS maintenance_reason
  FROM hosts h
  LEFT JOIN host_state s ON s.host_id = h.id
  LEFT JOIN type_thresholds t ON t.device_type = h.device_type
  LEFT JOIN hosts ph ON ph.id = h.parent_id
  LEFT JOIN outages o ON o.host_id = h.id AND o.ended_at IS NULL
  LEFT JOIN hosts ch ON ch.id = o.cause_host_id
  LEFT JOIN active a ON a.host_id = h.id
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS total,
           array_agg(c.name ORDER BY c.name) FILTER (WHERE c.status = 'failed') AS failed
    FROM service_checks c WHERE c.host_id = h.id
  ) sv ON true`;

/** `visible`: gli host che l'utente può leggere, null se tutti. */
const canRead = (visible: number[] | null, id: number | null) =>
  id !== null && (visible === null || visible.includes(id));

function deriveHealth(row: StateRow, visible: number[] | null): { status: HostStatus; reason: string | null } {
  if (!row.enabled) return { status: "paused", reason: null };
  if (row.maintenance_until !== null) return { status: "maintenance", reason: row.maintenance_reason || null };
  if (!row.status || row.status === "unknown" || row.last_check === null) return { status: "unknown", reason: null };
  if (nowSeconds() - row.last_check > STALE_AFTER_SECONDS) return { status: "unknown", reason: null };
  if (row.status === "offline") {
    if (row.cause_host_id === null) return { status: "offline", reason: null };
    return {
      status: "unreachable",
      reason: canRead(visible, row.cause_host_id) ? `Dipende da ${row.cause_name}` : null,
    };
  }

  const problems = healthProblems({
    failStreak: row.fail_streak ?? 0,
    lastLoss: row.last_loss,
    rtt1m: row.rtt_1m,
    loss1m: row.loss_1m,
    latencyWarn: row.latency_warn,
    lossWarn: row.loss_warn,
    failedServices: row.failed_services,
  });
  return problems.length > 0 ? { status: "unstable", reason: problems.join(" · ") } : { status: "online", reason: null };
}

/** Un utente limitato vede solo una parte degli host. */
const isLimited = (user: SessionUser) => user.role !== "admin" && user.restricted;

/**
 * Gli host che l'utente può leggere, oppure null se li può leggere tutti.
 * Ogni query che restituisce dati degli host deve passare da qui.
 */
export async function visibleHostIds(user: SessionUser): Promise<number[] | null> {
  if (!isLimited(user)) return null;

  const [accounts, hosts] = await Promise.all([
    db().query<{ sectors: string[]; host_ids: number[] }>("SELECT sectors, host_ids FROM users WHERE id = $1", [
      user.id,
    ]),
    db().query<{ id: number; group_name: string }>("SELECT id, group_name FROM hosts"),
  ]);

  const account = { sectors: accounts.rows[0]?.sectors ?? [], hostIds: accounts.rows[0]?.host_ids ?? [] };
  return hosts.rows
    .filter((host) => inAccount({ id: host.id, sector: host.group_name }, account))
    .map((host) => host.id);
}

/**
 * I dispositivi offline da più di 2 minuti, per il popup. Se il worker è fermo lo stato
 * non è aggiornato: meglio nessun popup, l'avviso sul worker fermo c'è già.
 */
export async function getLongOffline(user: SessionUser): Promise<LongOfflineFeed> {
  const [visible, pinger] = await Promise.all([visibleHostIds(user), getPingerStatus()]);
  if (!pinger.healthy) return { hosts: [], serverTime: nowSeconds() };

  // Chi vede la causa guarda quella: i dispositivi a valle restano solo nel conteggio.
  // Chi non la vede ha soltanto i suoi, quindi deve sapere che sono giù.
  const { rows } = await db().query<{
    id: number;
    name: string;
    address: string;
    group_name: string;
    since: number;
    dependents: number;
    ack_by: string | null;
  }>(
    `SELECT h.id, h.name, h.address, h.group_name, extract(epoch FROM s.since)::float8 AS since, o.ack_by,
            (SELECT count(*)::int FROM outages d
             WHERE d.ended_at IS NULL AND d.cause_host_id = h.id
               AND ($1::int[] IS NULL OR d.host_id = ANY($1::int[]))) AS dependents
     FROM host_state s
     JOIN hosts h ON h.id = s.host_id
     LEFT JOIN outages o ON o.host_id = h.id AND o.ended_at IS NULL
     WHERE h.enabled AND s.status = 'offline' AND s.since < now() - interval '${OFFLINE_POPUP_SECONDS} seconds'
       AND ($1::int[] IS NULL OR h.id = ANY($1::int[]))
       AND (o.cause_host_id IS NULL OR ($1::int[] IS NOT NULL AND NOT o.cause_host_id = ANY($1::int[])))
       AND h.id NOT IN (SELECT host_id FROM maintenance_hosts WHERE starts_at <= now() AND ends_at > now())
     ORDER BY s.since`,
    [visible],
  );
  return {
    hosts: rows.map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      sector: row.group_name,
      since: row.since,
      dependents: row.dependents,
      ackBy: row.ack_by,
    })),
    serverTime: nowSeconds(),
  };
}

export async function canSeeHost(user: SessionUser, id: number) {
  const visible = await visibleHostIds(user);
  return visible === null || visible.includes(id);
}

function toSummary(row: StateRow, visible: number[] | null): HostSummary {
  const { status, reason } = deriveHealth(row, visible);
  const parentShown = canRead(visible, row.parent_id);
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    sector: row.group_name,
    type: row.device_type,
    enabled: row.enabled,
    status,
    since: row.since,
    lastCheck: row.last_check,
    rtt: row.last_rtt,
    loss: row.last_loss,
    reason,
    pingEnabled: row.ping_enabled,
    latencyWarn: row.latency_warn,
    lossWarn: row.loss_warn,
    serviceCount: row.service_count,
    maintenanceUntil: row.maintenance_until,
    parentId: parentShown ? row.parent_id : null,
    parentName: parentShown ? row.parent_name : null,
  };
}

async function getPingerStatus(): Promise<PingerStatus> {
  const { rows } = await db().query<{ at: number }>(
    "SELECT extract(epoch FROM updated_at)::float8 AS at FROM system_state WHERE key = 'pinger'",
  );
  const lastBeat = rows[0]?.at ?? null;
  return { lastBeat, healthy: lastBeat !== null && nowSeconds() - lastBeat <= STALE_AFTER_SECONDS };
}

function mapOutage(
  row: {
    id: string;
    host_id: number;
    name: string;
    address: string;
    group_name: string;
    device_type: DeviceType;
    started: number;
    ended: number | null;
    service?: string;
    cause_host_id?: number | null;
    cause_name?: string | null;
    in_maintenance: boolean;
    ack_by: string | null;
    ack_at: number | null;
    note: string;
  },
  visible: number[] | null,
): OutageRow {
  return {
    id: Number(row.id),
    hostId: row.host_id,
    hostName: row.name,
    address: row.address,
    sector: row.group_name,
    type: row.device_type,
    started: row.started,
    ended: row.ended,
    service: row.service ?? null,
    causeName: canRead(visible, row.cause_host_id ?? null) ? (row.cause_name ?? null) : null,
    inMaintenance: row.in_maintenance,
    ackBy: row.ack_by,
    ackAt: row.ack_at,
    note: row.note,
  };
}

// Tutte le finestre: un guasto ancora aperto può essere iniziato in una ormai finita
const OUTAGE_WINDOWS = "WITH mw AS MATERIALIZED (SELECT host_id, starts_at, ends_at FROM maintenance_hosts)";
const OUTAGE_STATE = `($3::text IS NULL
         OR ($3 = 'noted' AND o.note <> '')
         OR ($3 <> 'noted' AND ($3 = 'open') = (o.ended_at IS NULL)))`;

interface OutageFilter {
  hostId?: number;
  /** null: tutti gli host */
  hostIds?: number[] | null;
  limit?: number;
  state?: "open" | "closed" | "noted";
}

async function queryServiceOutages(since: number, { hostIds, limit = 200, state }: OutageFilter) {
  const { rows } = await db().query(
    `${OUTAGE_WINDOWS}
     SELECT o.id, c.host_id, h.name, h.address, h.group_name, h.device_type, c.name AS service,
            extract(epoch FROM o.started_at)::float8 AS started,
            extract(epoch FROM o.ended_at)::float8 AS ended,
            o.ack_by, extract(epoch FROM o.ack_at)::float8 AS ack_at, o.note,
            EXISTS (SELECT 1 FROM mw WHERE mw.host_id = c.host_id
                    AND o.started_at >= mw.starts_at AND o.started_at < mw.ends_at) AS in_maintenance
     FROM service_outages o
     JOIN service_checks c ON c.id = o.check_id
     JOIN hosts h ON h.id = c.host_id
     WHERE (o.ended_at IS NULL OR o.ended_at >= to_timestamp($1::float8))
       AND ($2::int[] IS NULL OR c.host_id = ANY($2))
       AND ${OUTAGE_STATE}
     ORDER BY o.ended_at IS NULL DESC, o.started_at DESC
     LIMIT $4`,
    [since, hostIds ?? null, state ?? null, limit],
  );
  return rows.map((row) => mapOutage(row, hostIds ?? null));
}

async function queryOutages(since: number, { hostId, hostIds, limit = 200, state }: OutageFilter = {}) {
  const { rows } = await db().query(
    `${OUTAGE_WINDOWS}
     SELECT o.id, o.host_id, h.name, h.address, h.group_name, h.device_type,
            extract(epoch FROM o.started_at)::float8 AS started,
            extract(epoch FROM o.ended_at)::float8 AS ended,
            o.cause_host_id, ch.name AS cause_name,
            o.ack_by, extract(epoch FROM o.ack_at)::float8 AS ack_at, o.note,
            EXISTS (SELECT 1 FROM mw WHERE mw.host_id = o.host_id
                    AND o.started_at >= mw.starts_at AND o.started_at < mw.ends_at) AS in_maintenance
     FROM outages o
     JOIN hosts h ON h.id = o.host_id
     LEFT JOIN hosts ch ON ch.id = o.cause_host_id
     WHERE (o.ended_at IS NULL OR o.ended_at >= to_timestamp($1::float8))
       AND ($2::int IS NULL OR o.host_id = $2)
       AND ${OUTAGE_STATE}
       AND ($5::int[] IS NULL OR o.host_id = ANY($5))
     ORDER BY o.ended_at IS NULL DESC, o.started_at DESC
     LIMIT $4`,
    [since, hostId ?? null, state ?? null, limit, hostIds ?? null],
  );
  return rows.map((row) => mapOutage(row, hostIds ?? null));
}

/** Le finestre già iniziate che toccano il periodo, per host. Comprendono gli host a valle. */
async function loadMaintenanceSpans(from: number, hostId: number | null = null) {
  const { rows } = await db().query<{ host_id: number; first: number; last: number }>(
    `SELECT DISTINCT host_id,
            extract(epoch FROM starts_at)::float8 AS first,
            extract(epoch FROM ends_at)::float8 AS last
     FROM maintenance_hosts
     WHERE ends_at >= to_timestamp($1::float8) AND starts_at <= now()
       AND ($2::int IS NULL OR host_id = $2)`,
    [from, hostId],
  );

  const byHost = new Map<number, MaintenanceSpan[]>();
  for (const row of rows) {
    const list = byHost.get(row.host_id);
    if (list) list.push([row.first, row.last]);
    else byHost.set(row.host_id, [[row.first, row.last]]);
  }
  return byHost;
}

// L'inizio dell'intervallo a cui appartiene `ts`. Su milioni di righe date_bin è 2,5 volte più
// veloce dell'aritmetica numeric. Il GROUP BY usa questa stessa espressione, così la conversione
// in secondi si fa una volta per gruppo e non una per riga.
const bucketOf = (seconds: string) => `date_bin(make_interval(secs => ${seconds}::float8), ts, timestamptz 'epoch')`;
const bucketEpoch = (seconds: string) => `extract(epoch FROM ${bucketOf(seconds)})::float8`;

// Un ping dentro una manutenzione non pesa su disponibilità, latenza e perdita.
// La tabella delle finestre è minuscola: MATERIALIZED la calcola una volta sola per tutta la query.
const pingWindows = (from: string) =>
  `WITH mw AS MATERIALIZED (
     SELECT host_id, starts_at, ends_at FROM maintenance_hosts WHERE ends_at >= to_timestamp(${from}::float8)
   )`;
const OUTSIDE_MAINTENANCE = `NOT EXISTS (
         SELECT 1 FROM mw WHERE mw.host_id = p.host_id AND p.ts >= mw.starts_at AND p.ts < mw.ends_at
       )`;

interface HostHistory {
  lat: (number | null)[];
  up: (number | null)[];
  checks: number;
  okChecks: number;
  sent: number;
  received: number;
  rttWeighted: number;
}

interface History {
  t: number[];
  byHost: Map<number, HostHistory>;
  spans: Map<number, MaintenanceSpan[]>;
}

const historyCache = new Map<RangeKey, { at: number; value: Promise<History> }>();

async function loadHistory(range: RangeKey): Promise<History> {
  const { bucket } = RANGES[range];
  const { first, t } = bucketAxis(range);

  const spansLoaded = loadMaintenanceSpans(first);
  const { rows } = await db().query<{
    host_id: number;
    b: number;
    n: number;
    ok: number;
    sent: number;
    recv: number;
    lat: number | null;
  }>(
    `${pingWindows("$1")}
     SELECT host_id,
            ${bucketEpoch("$2")} AS b,
            count(*)::int AS n,
            count(*) FILTER (WHERE online)::int AS ok,
            sum(sent)::int AS sent,
            sum(received)::int AS recv,
            avg(rtt_avg)::float8 AS lat
     FROM ping_results p
     WHERE ts >= to_timestamp($1::float8) AND ${OUTSIDE_MAINTENANCE}
     GROUP BY host_id, ${bucketOf("$2")}`,
    [first, bucket],
  );

  const byHost = new Map<number, HostHistory>();
  for (const row of rows) {
    const index = Math.round((row.b - first) / bucket);
    if (index < 0 || index >= t.length) continue;

    let entry = byHost.get(row.host_id);
    if (!entry) {
      entry = {
        lat: new Array(t.length).fill(null),
        up: new Array(t.length).fill(null),
        checks: 0,
        okChecks: 0,
        sent: 0,
        received: 0,
        rttWeighted: 0,
      };
      byHost.set(row.host_id, entry);
    }
    entry.lat[index] = row.lat;
    entry.up[index] = row.ok / row.n;
    entry.checks += row.n;
    entry.okChecks += row.ok;
    entry.sent += row.sent;
    entry.received += row.recv;
    entry.rttWeighted += (row.lat ?? 0) * row.ok;
  }
  return { t, byHost, spans: await spansLoaded };
}

function getHistory(range: RangeKey) {
  const now = Date.now();
  const hit = historyCache.get(range);
  if (hit && now - hit.at < RANGES[range].ttl * 1000) return hit.value;

  // La promessa in cache fa condividere la stessa query a chi arriva nello stesso momento
  const value = loadHistory(range);
  historyCache.set(range, { at: now, value });
  value.catch(() => historyCache.delete(range));
  return value;
}

export async function getOverview(range: RangeKey, user: SessionUser): Promise<OverviewData> {
  const { seconds, bucket } = RANGES[range];
  const since = nowSeconds() - seconds;
  const visible = await visibleHostIds(user);

  const [hostResult, history, pinger, outages] = await Promise.all([
    db().query<StateRow>(`${HOST_SELECT} WHERE $1::int[] IS NULL OR h.id = ANY($1) ORDER BY lower(h.name)`, [visible]),
    getHistory(range),
    getPingerStatus(),
    queryOutages(since, { hostIds: visible }),
  ]);

  const empty = new Array(history.t.length).fill(null);
  const hosts: HostRow[] = hostResult.rows.map((row) => {
    const entry = history.byHost.get(row.id);
    return {
      ...toSummary(row, visible),
      uptime: entry?.checks ? (100 * entry.okChecks) / entry.checks : null,
      avgRtt: entry?.okChecks ? entry.rttWeighted / entry.okChecks : null,
      lossRange: entry?.sent ? 100 * (1 - entry.received / entry.sent) : null,
      lat: entry?.lat ?? empty,
      up: entry?.up ?? empty,
      maintenance: history.spans.get(row.id) ?? [],
    };
  });

  return {
    range,
    serverTime: nowSeconds(),
    bucketSeconds: bucket,
    pinger,
    t: history.t,
    hosts,
    outages,
    restricted: visible !== null,
  };
}

export async function getHostDetail(id: number, range: RangeKey, user: SessionUser): Promise<HostDetailData | null> {
  const visible = await visibleHostIds(user);
  if (visible !== null && !visible.includes(id)) return null;

  const { rows: hostRows } = await db().query<StateRow>(`${HOST_SELECT} WHERE h.id = $1`, [id]);
  if (hostRows.length === 0) return null;

  const { seconds, bucket } = RANGES[range];
  const { first, t } = bucketAxis(range);
  const since = nowSeconds() - seconds;

  const [bucketResult, percentile, pinger, outages, services, spans] = await Promise.all([
    db().query<{
      b: number;
      n: number;
      ok: number;
      sent: number;
      recv: number;
      lat: number | null;
      lo: number | null;
      hi: number | null;
    }>(
      `${pingWindows("$2")}
       SELECT ${bucketEpoch("$3")} AS b,
              count(*)::int AS n,
              count(*) FILTER (WHERE online)::int AS ok,
              sum(sent)::int AS sent,
              sum(received)::int AS recv,
              avg(rtt_avg)::float8 AS lat,
              min(rtt_min)::float8 AS lo,
              max(rtt_max)::float8 AS hi
       FROM ping_results p
       WHERE host_id = $1 AND ts >= to_timestamp($2::float8) AND ${OUTSIDE_MAINTENANCE}
       GROUP BY ${bucketOf("$3")}`,
      [id, first, bucket],
    ),
    db().query<{ p95: number | null }>(
      `${pingWindows("$2")}
       SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY rtt_avg)::float8 AS p95
       FROM ping_results p
       WHERE host_id = $1 AND ts >= to_timestamp($2::float8) AND rtt_avg IS NOT NULL AND ${OUTSIDE_MAINTENANCE}`,
      [id, first],
    ),
    getPingerStatus(),
    queryOutages(since, { hostId: id, hostIds: visible }),
    queryServices(null, id),
    loadMaintenanceSpans(first, id),
  ]);

  const blank = () => new Array<number | null>(t.length).fill(null);
  const avg = blank();
  const min = blank();
  const max = blank();
  const lossSeries = blank();
  const up = blank();

  let checks = 0;
  let okChecks = 0;
  let sent = 0;
  let received = 0;
  let rttWeighted = 0;
  let minRtt: number | null = null;
  let maxRtt: number | null = null;

  for (const row of bucketResult.rows) {
    const index = Math.round((row.b - first) / bucket);
    if (index < 0 || index >= t.length) continue;
    avg[index] = row.lat;
    min[index] = row.lo;
    max[index] = row.hi;
    lossSeries[index] = row.sent ? 100 * (1 - row.recv / row.sent) : null;
    up[index] = row.ok / row.n;

    checks += row.n;
    okChecks += row.ok;
    sent += row.sent;
    received += row.recv;
    rttWeighted += (row.lat ?? 0) * row.ok;
    if (row.lo !== null) minRtt = minRtt === null ? row.lo : Math.min(minRtt, row.lo);
    if (row.hi !== null) maxRtt = maxRtt === null ? row.hi : Math.max(maxRtt, row.hi);
  }

  const now = nowSeconds();
  const maintenance = spans.get(id) ?? [];
  const downtimeSeconds = outages.reduce((total, outage) => {
    const from = Math.max(outage.started, since);
    const to = outage.ended ?? now;
    return total + Math.max(0, to - from - overlapSeconds(from, to, maintenance));
  }, 0);

  return {
    range,
    serverTime: now,
    bucketSeconds: bucket,
    pinger,
    host: toSummary(hostRows[0], visible),
    stats: {
      uptime: checks ? (100 * okChecks) / checks : null,
      avgRtt: okChecks ? rttWeighted / okChecks : null,
      minRtt,
      maxRtt,
      p95Rtt: percentile.rows[0]?.p95 ?? null,
      loss: sent ? 100 * (1 - received / sent) : null,
      outageCount: outages.filter((outage) => !outage.inMaintenance).length,
      downtimeSeconds,
    },
    t,
    avg,
    min,
    max,
    lossSeries,
    up,
    maintenance,
    outages,
    services,
  };
}

export async function getEvents(user: SessionUser, range: RangeKey, state?: OutageFilter["state"]): Promise<EventsData> {
  // Le note sopravvivono alla pulizia e si cercano anche mesi dopo: il periodo non si applica
  const since = state === "noted" ? 0 : nowSeconds() - RANGES[range].seconds;
  const hostIds = await visibleHostIds(user);
  const filter = { hostIds, state, limit: 500 };

  const [hostOutages, serviceOutages, pinger] = await Promise.all([
    queryOutages(since, filter),
    queryServiceOutages(since, filter),
    getPingerStatus(),
  ]);

  const outages = [...hostOutages, ...serviceOutages]
    .sort((a, b) => Number(b.ended === null) - Number(a.ended === null) || b.started - a.started)
    .slice(0, 500);
  return { range, serverTime: nowSeconds(), pinger, outages };
}

async function queryServices(hostIds: number[] | null, hostId?: number): Promise<ServiceRow[]> {
  const { rows } = await db().query<{
    id: number;
    host_id: number;
    host_name: string;
    address: string;
    group_name: string;
    device_type: DeviceType;
    enabled: boolean;
    name: string;
    kind: ServiceKind;
    port: number | null;
    url: string | null;
    warn_days: number;
    status: ServiceStatus;
    since: number | null;
    last_check: number | null;
    ms: number | null;
    detail: string;
  }>(
    `SELECT c.id, c.host_id, h.name AS host_name, h.address, h.group_name, h.device_type, h.enabled,
            c.name, c.kind, c.port, c.url, c.warn_days, c.status, c.detail,
            extract(epoch FROM c.since)::float8 AS since,
            extract(epoch FROM c.last_check)::float8 AS last_check,
            c.last_ms::float8 AS ms
     FROM service_checks c JOIN hosts h ON h.id = c.host_id
     WHERE ($1::int[] IS NULL OR c.host_id = ANY($1)) AND ($2::int IS NULL OR c.host_id = $2)
     ORDER BY c.status = 'failed' DESC, c.status = 'warn' DESC, lower(h.name), lower(c.name)`,
    [hostIds, hostId ?? null],
  );

  const now = nowSeconds();
  return rows.map((row) => {
    // Come per gli host: un dato vecchio non deve sembrare un servizio attivo
    const limit = row.kind === "cert" ? CERT_STALE_SECONDS : SERVICE_STALE_SECONDS;
    const stale = row.last_check === null || now - row.last_check > limit;
    return {
      id: row.id,
      hostId: row.host_id,
      hostName: row.host_name,
      address: row.address,
      sector: row.group_name,
      type: row.device_type,
      paused: !row.enabled,
      name: row.name,
      kind: row.kind,
      port: row.port,
      url: row.url,
      warnDays: row.warn_days,
      status: stale ? "unknown" : row.status,
      since: row.since,
      lastCheck: row.last_check,
      ms: row.ms,
      detail: row.detail,
    };
  });
}

export async function getServices(user: SessionUser): Promise<ServicesData> {
  const [services, pinger] = await Promise.all([queryServices(await visibleHostIds(user)), getPingerStatus()]);
  return { serverTime: nowSeconds(), pinger, services };
}

export async function getServerData(range: RangeKey): Promise<ServerData> {
  const bucket = Math.max(RANGES[range].bucket, SERVER_BUCKET_SECONDS);
  const last = Math.floor(nowSeconds() / bucket) * bucket;
  const count = Math.round(RANGES[range].seconds / bucket);
  const first = last - (count - 1) * bucket;
  const t = Array.from({ length: count }, (_, index) => first + index * bucket);

  const [metrics, state] = await Promise.all([
    db().query<{ b: number; cpu: number | null; mem: number | null; swap: number | null; disk: number | null }>(
      `SELECT ${bucketEpoch("$2")} AS b,
              avg(cpu_pct)::float8 AS cpu, avg(mem_pct)::float8 AS mem,
              avg(swap_pct)::float8 AS swap, avg(disk_pct)::float8 AS disk
       FROM server_metrics
       WHERE ts >= to_timestamp($1::float8)
       GROUP BY ${bucketOf("$2")}`,
      [first, bucket],
    ),
    db().query<{ value: ServerSnapshot; at: number }>(
      "SELECT value, extract(epoch FROM updated_at)::float8 AS at FROM system_state WHERE key = 'server_health'",
    ),
  ]);

  const blank = () => new Array<number | null>(count).fill(null);
  const series = { cpu: blank(), mem: blank(), swap: blank(), disk: blank() };
  for (const row of metrics.rows) {
    const index = Math.round((row.b - first) / bucket);
    if (index < 0 || index >= count) continue;
    series.cpu[index] = row.cpu;
    series.mem[index] = row.mem;
    series.swap[index] = row.swap;
    series.disk[index] = row.disk;
  }

  const now = nowSeconds();
  const sampledAt = state.rows[0]?.at ?? null;
  return {
    range,
    serverTime: now,
    sampledAt,
    stale: sampledAt === null || now - sampledAt > SERVER_STALE_SECONDS,
    current: state.rows[0]?.value ?? null,
    t,
    ...series,
  };
}

/**
 * Gli avvisi dopo `after`, dal più vecchio. Senza `after` dice solo da dove partire:
 * un PC appena collegato non deve ricevere lo storico. Gli avvisi sul server sono per gli admin.
 * L'avviso di un dispositivo a valle arriva solo a chi non vede la causa: gli altri hanno già quello.
 */
export async function getAlertFeed(user: SessionUser, after: number | null) {
  const [visible, pinger, top] = await Promise.all([
    visibleHostIds(user),
    getPingerStatus(),
    db().query<{ latest: string }>("SELECT coalesce(max(id), 0) AS latest FROM alerts"),
  ]);
  const latest = Number(top.rows[0].latest);
  if (after === null) return { latest, pinger, alerts: [] as Alert[], more: false };

  const { rows } = await db().query<{
    id: string;
    ts: number;
    host_id: number | null;
    level: Alert["level"];
    title: string;
    body: string;
  }>(
    `SELECT id, extract(epoch FROM ts)::float8 AS ts, host_id, level, title, body
     FROM alerts
     WHERE id > $1 AND ($2::boolean OR host_id IS NOT NULL) AND ($3::int[] IS NULL OR host_id = ANY($3))
       AND (caused_by IS NULL OR ($3::int[] IS NOT NULL AND NOT caused_by = ANY($3)))
     ORDER BY id DESC
     LIMIT $4`,
    [after, user.role === "admin", visible, ALERT_PAGE + 1],
  );

  const alerts: Alert[] = rows
    .slice(0, ALERT_PAGE)
    .map((row) => ({
      id: Number(row.id),
      ts: row.ts,
      hostId: row.host_id,
      level: row.level,
      title: row.title,
      body: row.body,
    }))
    .reverse();
  return { latest, pinger, alerts, more: rows.length > ALERT_PAGE };
}

export async function listAlertDevices(user: SessionUser): Promise<AlertDevice[]> {
  const { rows } = await db().query<{ id: number; name: string; created: number; seen: number | null }>(
    `SELECT id, name, extract(epoch FROM created_at)::float8 AS created, extract(epoch FROM last_seen)::float8 AS seen
     FROM alert_devices WHERE user_id = $1 ORDER BY lower(name)`,
    [user.id],
  );
  return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created, lastSeen: row.seen }));
}

export async function listHosts() {
  const { rows } = await db().query<{
    id: number;
    name: string;
    address: string;
    group_name: string;
    device_type: DeviceType;
    enabled: boolean;
    ping_enabled: boolean;
    latency_warn_ms: number | null;
    loss_warn_pct: number | null;
    parent_id: number | null;
  }>(
    `SELECT id, name, address, group_name, device_type, enabled, ping_enabled, latency_warn_ms, loss_warn_pct, parent_id
     FROM hosts ORDER BY lower(group_name), lower(name)`,
  );
  return rows;
}

/** In corso e programmate prima, poi le concluse dalla più recente. */
/**
 * Le planimetrie che l'utente può vedere, con lo stato dei dispositivi. Un account limitato
 * vede solo le piante con almeno un suo dispositivo, e sulla pianta soltanto i suoi.
 */
export async function listFloorPlans(user: SessionUser): Promise<FloorPlan[]> {
  const visible = await visibleHostIds(user);
  const [plans, positions, hosts] = await Promise.all([
    db().query<{ id: number; name: string; version: number }>(
      "SELECT id, name, version FROM floor_plans ORDER BY lower(name)",
    ),
    db().query<{ plan_id: number; host_id: number; x: number; y: number }>(
      "SELECT plan_id, host_id, x::float8 AS x, y::float8 AS y FROM floor_plan_hosts",
    ),
    db().query<StateRow>(
      `${HOST_SELECT} WHERE h.id IN (SELECT host_id FROM floor_plan_hosts) AND ($1::int[] IS NULL OR h.id = ANY($1))`,
      [visible],
    ),
  ]);

  const byId = new Map(hosts.rows.map((row) => [row.id, toSummary(row, visible)]));
  return plans.rows.flatMap((plan) => {
    const markers = positions.rows
      .filter((position) => position.plan_id === plan.id)
      .flatMap((position) => {
        const host = byId.get(position.host_id);
        if (!host) return [];
        const { id, name, address, status, reason } = host;
        return [{ hostId: id, name, address, status, reason, x: position.x, y: position.y }];
      });
    return visible !== null && markers.length === 0 ? [] : [{ ...plan, markers }];
  });
}

export async function getFloorPlan(id: number, user: SessionUser) {
  const plans = await listFloorPlans(user);
  return plans.find((plan) => plan.id === id) ?? null;
}

export async function getFloorPlanImage(id: number, user: SessionUser) {
  if (!(await getFloorPlan(id, user))) return null;
  const { rows } = await db().query<{ image: Buffer; mime: string }>("SELECT image, mime FROM floor_plans WHERE id = $1", [
    id,
  ]);
  return rows[0] ?? null;
}

/** L'ultima ricerca sulla rete. Cosa è già presente si calcola adesso: gli host cambiano. */
export async function getLatestScan(): Promise<DiscoveryScan | null> {
  const [scans, hosts] = await Promise.all([
    db().query<{
      id: number;
      subnet: string;
      status: DiscoveryScan["status"];
      total: number;
      checked: number;
      error: string;
      created_by: string;
      created: number;
      found: Omit<DiscoveryItem, "known">[];
    }>(
      `SELECT id, subnet, status, total, checked, error, created_by, found,
              extract(epoch FROM created_at)::float8 AS created
       FROM discovery_scans ORDER BY id DESC LIMIT 1`,
    ),
    db().query<{ id: number; name: string; address: string }>("SELECT id, name, lower(address) AS address FROM hosts"),
  ]);

  const scan = scans.rows[0];
  if (!scan) return null;
  const byAddress = new Map(hosts.rows.map((host) => [host.address, host]));
  return {
    id: scan.id,
    subnet: scan.subnet,
    status: scan.status,
    total: scan.total,
    checked: scan.checked,
    error: scan.error,
    createdBy: scan.created_by,
    created: scan.created,
    found: scan.found.map((item) => {
      const host = byAddress.get(item.address) ?? byAddress.get(item.name?.toLowerCase() ?? "");
      return { ...item, known: host ? { id: host.id, name: host.name } : null };
    }),
  };
}

export async function listMaintenance(): Promise<MaintenanceWindow[]> {
  const { rows } = await db().query<{
    id: number;
    host_id: number | null;
    host_name: string | null;
    sector: string | null;
    starts: number;
    ends: number;
    reason: string;
    created_by: string;
    covered: number;
  }>(
    `WITH covered AS MATERIALIZED (
       SELECT window_id, count(DISTINCT host_id)::int AS hosts FROM maintenance_hosts GROUP BY 1
     )
     SELECT w.id, w.host_id, h.name AS host_name, w.sector, w.reason, w.created_by,
            extract(epoch FROM w.starts_at)::float8 AS starts,
            extract(epoch FROM w.ends_at)::float8 AS ends,
            coalesce(c.hosts, 0) AS covered
     FROM maintenance_windows w
     LEFT JOIN hosts h ON h.id = w.host_id
     LEFT JOIN covered c ON c.window_id = w.id
     ORDER BY w.ends_at <= now(), CASE WHEN w.ends_at > now() THEN w.starts_at END, w.ends_at DESC`,
  );

  const now = nowSeconds();
  return rows.map((row) => ({
    id: row.id,
    hostId: row.host_id,
    hostName: row.host_name,
    sector: row.sector,
    starts: row.starts,
    ends: row.ends,
    reason: row.reason,
    createdBy: row.created_by,
    covered: row.covered,
    state: row.ends <= now ? "done" : row.starts <= now ? "running" : "scheduled",
  }));
}

/** Gli host che l'utente può scegliere nelle sue viste. */
export async function listVisibleHosts(user: SessionUser) {
  const [hosts, visible] = await Promise.all([listHosts(), visibleHostIds(user)]);
  return visible === null ? hosts : hosts.filter((host) => visible.includes(host.id));
}

export async function listTypeThresholds() {
  const { rows } = await db().query<{
    device_type: DeviceType;
    latency_warn_ms: number | null;
    loss_warn_pct: number | null;
  }>("SELECT device_type, latency_warn_ms, loss_warn_pct FROM type_thresholds");
  return rows;
}

interface ProfileRow {
  id: number;
  name: string;
  owner_id: number | null;
  sectors: string[];
  device_types: string[];
  host_ids: number[];
  view_mode: ViewMode;
  group_by: GroupBy;
  range_key: string;
  panels: string[];
}

function toProfile(row: ProfileRow, user: SessionUser): Profile {
  return {
    id: row.id,
    name: row.name,
    shared: row.owner_id === null,
    canEdit: row.owner_id === null ? user.role === "admin" : row.owner_id === user.id,
    sectors: row.sectors,
    types: row.device_types.filter(isDeviceType),
    hostIds: row.host_ids,
    view: isViewMode(row.view_mode) ? row.view_mode : "cards",
    groupBy: isGroupBy(row.group_by) ? row.group_by : "none",
    range: parseRange(row.range_key),
    panels: row.panels.filter(isPanel),
  };
}

// Una vista condivisa nomina settori e host che un account limitato può non avere: lui vede solo le sue
const PROFILE_VISIBLE = "(owner_id = $1 OR (owner_id IS NULL AND NOT $2::boolean))";

/** I profili condivisi e quelli personali dell'utente: gli altri non si vedono. */
export async function listProfiles(user: SessionUser) {
  const { rows } = await db().query<ProfileRow>(
    `SELECT * FROM profiles WHERE ${PROFILE_VISIBLE}
     ORDER BY owner_id IS NOT NULL, lower(name)`,
    [user.id, isLimited(user)],
  );
  return rows.map((row) => toProfile(row, user));
}

export async function getProfile(id: number, user: SessionUser) {
  if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647) return null;
  const { rows } = await db().query<ProfileRow>(`SELECT * FROM profiles WHERE id = $3 AND ${PROFILE_VISIBLE}`, [
    user.id,
    isLimited(user),
    id,
  ]);
  return rows[0] ? toProfile(rows[0], user) : null;
}

export async function listUsers() {
  const { rows } = await db().query<{
    id: number;
    username: string;
    role: "admin" | "viewer";
    last_login: number | null;
    restricted: boolean;
    sectors: string[];
    host_ids: number[];
  }>(
    `SELECT id, username, role, restricted, sectors, host_ids, extract(epoch FROM last_login_at)::float8 AS last_login
     FROM users ORDER BY lower(username)`,
  );
  return rows;
}

export async function getSystemInfo() {
  const [pinger, stateResult, sizes, cleanups, factsResult, database] = await Promise.all([
    getPingerStatus(),
    db().query<{ key: string; value: { at?: string; durationMs?: number; hosts?: number } }>(
      "SELECT key, value FROM system_state WHERE key IN ('pinger', 'last_cleanup')",
    ),
    db().query<{ db_bytes: number; table_bytes: number; rows: number; oldest: number | null }>(
      `SELECT pg_database_size(current_database())::float8 AS db_bytes,
              pg_total_relation_size('ping_results')::float8 AS table_bytes,
              (SELECT greatest(reltuples, 0)::float8 FROM pg_class WHERE oid = 'ping_results'::regclass) AS rows,
              (SELECT extract(epoch FROM min(ts))::float8 FROM ping_results) AS oldest`,
    ),
    db().query<{ ran_at: number; cutoff: number; ping_rows: number; outage_rows: number }>(
      `SELECT extract(epoch FROM ran_at)::float8 AS ran_at,
              extract(epoch FROM cutoff)::float8 AS cutoff,
              ping_rows::float8 AS ping_rows, outage_rows::float8 AS outage_rows
       FROM cleanup_log ORDER BY ran_at DESC LIMIT 10`,
    ),
    db().query<{ value: SystemFacts; updated_at: number }>(
      "SELECT value, extract(epoch FROM updated_at)::float8 AS updated_at FROM system_state WHERE key = 'system_facts'",
    ),
    db().query<{ version: string; started_at: number; timezone: string; connections: number; max_connections: number }>(
      `SELECT current_setting('server_version') AS version,
              extract(epoch FROM pg_postmaster_start_time())::float8 AS started_at,
              current_setting('TimeZone') AS timezone,
              (SELECT count(*)::float8 FROM pg_stat_activity WHERE datname = current_database()) AS connections,
              current_setting('max_connections')::float8 AS max_connections`,
    ),
  ]);

  const state = new Map(stateResult.rows.map((row) => [row.key, row.value]));
  const cycleDays = Number(process.env.RETENTION_CYCLE_DAYS ?? 14);
  const keepDays = Number(process.env.RETENTION_KEEP_DAYS ?? 7);
  const lastAt = state.get("last_cleanup")?.at;
  const lastCleanup = lastAt ? new Date(lastAt).getTime() / 1000 : null;

  return {
    pinger,
    cycleDurationMs: state.get("pinger")?.durationMs ?? null,
    hostsPinged: state.get("pinger")?.hosts ?? null,
    cycleDays,
    keepDays,
    lastCleanup,
    nextCleanup: lastCleanup === null ? null : lastCleanup + cycleDays * 86_400,
    ...sizes.rows[0],
    cleanups: cleanups.rows,
    facts: factsResult.rows[0]?.value ?? null,
    factsAt: factsResult.rows[0]?.updated_at ?? null,
    database: database.rows[0],
  };
}
