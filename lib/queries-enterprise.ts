import "server-only";
// Le letture delle funzioni nuove: impostazioni, scadenze, report, registro, chiavi API,
// inventario, pagina di stato e salute.
import type { SessionUser } from "./auth";
import { db } from "./db";
import { getPingerStatus, getStatesOf, visibleHostIds } from "./queries";
import { monthLabel } from "./report.mjs";
import type { DeviceType } from "./scope";
import { normalizeAlertSettings, normalizeStatusSettings } from "./settings.mjs";
import type { HostStatus } from "./types";

export interface AlertSettings {
  quietEnabled: boolean;
  quietFrom: string;
  quietTo: string;
  timeZone: string;
  escalationMinutes: number;
  warrantyDays: number;
}

export interface StatusSettings {
  enabled: boolean;
  title: string;
  note: string;
}

async function readSetting(key: string) {
  const { rows } = await db().query<{ value: unknown; updated_at: number; updated_by: string | null }>(
    "SELECT value, extract(epoch FROM updated_at)::float8 AS updated_at, updated_by FROM settings WHERE key = $1",
    [key],
  );
  return rows[0] ?? null;
}

export async function getAlertSettings(): Promise<AlertSettings> {
  return normalizeAlertSettings((await readSetting("alerts"))?.value);
}

export async function getStatusSettings(): Promise<StatusSettings> {
  return normalizeStatusSettings((await readSetting("status"))?.value);
}

// Backup

export interface BackupFile {
  name: string;
  bytes: number;
  at: string;
}

export interface BackupState {
  dir: string | null;
  keep: number | null;
  pgDump: string | null;
  running: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  file: string | null;
  bytes: number | null;
  durationMs: number | null;
  error: string | null;
  files: BackupFile[];
  /** Una richiesta "Esegui ora" che il worker non ha ancora visto. */
  requestPending: boolean;
}

export async function getBackupState(): Promise<BackupState> {
  const { rows } = await db().query<{ key: string; value: Record<string, unknown>; updated_at: number }>(
    `SELECT key, value, extract(epoch FROM updated_at)::float8 AS updated_at
     FROM system_state WHERE key IN ('backup', 'backup_request')`,
  );
  const state = rows.find((row) => row.key === "backup")?.value ?? {};
  const request = rows.find((row) => row.key === "backup_request");
  const string = (value: unknown) => (typeof value === "string" && value ? value : null);
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const lastAttemptAt = string(state.lastAttemptAt);
  return {
    dir: string(state.dir),
    keep: number(state.keep),
    pgDump: string(state.pgDump),
    running: state.running === true,
    lastAttemptAt,
    lastSuccessAt: string(state.lastSuccessAt),
    file: string(state.file),
    bytes: number(state.bytes),
    durationMs: number(state.durationMs),
    error: string(state.error),
    files: Array.isArray(state.files) ? (state.files as BackupFile[]).slice(0, 60) : [],
    requestPending: !!request && (!lastAttemptAt || request.updated_at * 1000 > Date.parse(lastAttemptAt)),
  };
}

// Scadenze

export interface DomainRow {
  id: number;
  name: string;
  warnDays: number;
  expiresAt: number | null;
  registrar: string | null;
  source: "rdap" | "whois" | null;
  checkedAt: number | null;
  error: string | null;
}

export interface CertRow {
  id: number;
  name: string;
  hostId: number;
  hostName: string;
  warnDays: number;
  expiresAt: number | null;
  status: "unknown" | "ok" | "warn" | "failed";
  detail: string;
  lastCheck: number | null;
}

export interface WarrantyRow {
  id: number;
  name: string;
  sector: string;
  manufacturer: string | null;
  model: string | null;
  warrantyUntil: string;
}

export async function getDeadlines(user: SessionUser) {
  const visible = await visibleHostIds(user);
  const [domains, certs, warranties] = await Promise.all([
    db().query<{
      id: number;
      name: string;
      warn_days: number;
      expires_at: number | null;
      registrar: string | null;
      source: DomainRow["source"];
      checked_at: number | null;
      error: string | null;
    }>(
      `SELECT id, name, warn_days, extract(epoch FROM expires_at)::float8 AS expires_at, registrar, source,
              extract(epoch FROM checked_at)::float8 AS checked_at, error
       FROM domains ORDER BY expires_at NULLS FIRST, name`,
    ),
    db().query<{
      id: number;
      name: string;
      host_id: number;
      host_name: string;
      warn_days: number;
      expires_at: number | null;
      status: CertRow["status"];
      detail: string;
      last_check: number | null;
    }>(
      `SELECT c.id, c.name, c.host_id, h.name AS host_name, c.warn_days,
              extract(epoch FROM c.expires_at)::float8 AS expires_at, c.status, c.detail,
              extract(epoch FROM c.last_check)::float8 AS last_check
       FROM service_checks c JOIN hosts h ON h.id = c.host_id
       WHERE c.kind = 'cert' AND ($1::int[] IS NULL OR c.host_id = ANY($1::int[]))
       ORDER BY c.expires_at NULLS FIRST, lower(c.name)`,
      [visible],
    ),
    db().query<{
      id: number;
      name: string;
      group_name: string;
      manufacturer: string | null;
      model: string | null;
      warranty_until: string;
    }>(
      `SELECT id, name, group_name, manufacturer, model, to_char(warranty_until, 'YYYY-MM-DD') AS warranty_until
       FROM hosts
       WHERE warranty_until IS NOT NULL AND ($1::int[] IS NULL OR id = ANY($1::int[]))
       ORDER BY warranty_until, lower(name) LIMIT 500`,
      [visible],
    ),
  ]);
  return {
    domains: domains.rows.map(
      (row): DomainRow => ({
        id: row.id,
        name: row.name,
        warnDays: row.warn_days,
        expiresAt: row.expires_at,
        registrar: row.registrar,
        source: row.source,
        checkedAt: row.checked_at,
        error: row.error,
      }),
    ),
    certs: certs.rows.map(
      (row): CertRow => ({
        id: row.id,
        name: row.name,
        hostId: row.host_id,
        hostName: row.host_name,
        warnDays: row.warn_days,
        expiresAt: row.expires_at,
        status: row.status,
        detail: row.detail,
        lastCheck: row.last_check,
      }),
    ),
    warranties: warranties.rows.map(
      (row): WarrantyRow => ({
        id: row.id,
        name: row.name,
        sector: row.group_name,
        manufacturer: row.manufacturer,
        model: row.model,
        warrantyUntil: row.warranty_until,
      }),
    ),
  };
}

// Report

export interface ReportRow {
  month: string;
  label: string;
  createdAt: number;
  bytes: number;
  availability: number | null;
  outages: number | null;
  hosts: number | null;
}

export async function listReports(): Promise<ReportRow[]> {
  const { rows } = await db().query<{
    month: string;
    created_at: number;
    bytes: number;
    availability: number | null;
    outages: number | null;
    hosts: number | null;
  }>(
    `SELECT to_char(month, 'YYYY-MM') AS month, extract(epoch FROM created_at)::float8 AS created_at,
            octet_length(pdf) AS bytes,
            (summary->'kpi'->>'availability')::float8 AS availability,
            (summary->'kpi'->>'outages')::int AS outages,
            (summary->'kpi'->>'hosts')::int AS hosts
     FROM reports ORDER BY month DESC LIMIT 36`,
  );
  return rows.map((row) => ({
    month: row.month,
    label: monthLabel(row.month),
    createdAt: row.created_at,
    bytes: row.bytes,
    availability: row.availability,
    outages: row.outages,
    hosts: row.hosts,
  }));
}

export async function getReportPdf(month: string): Promise<Buffer | null> {
  const { rows } = await db().query<{ pdf: Buffer }>("SELECT pdf FROM reports WHERE month = $1::date", [
    `${month}-01`,
  ]);
  return rows[0]?.pdf ?? null;
}

// Registro delle attività

export interface AuditRow {
  id: number;
  ts: number;
  username: string | null;
  action: string;
  target: string | null;
  detail: unknown;
  ip: string | null;
}

export interface AuditFilter {
  user?: string;
  action?: string;
  /** Testo cercato nell'oggetto dell'azione. */
  q?: string;
  /** Pagine all'indietro: le righe con id minore di questo. */
  before?: number;
  limit?: number;
}

export async function listAudit({ user, action, q, before, limit = 100 }: AuditFilter = {}) {
  const { rows } = await db().query<{
    id: string;
    ts: number;
    username: string | null;
    action: string;
    target: string | null;
    detail: unknown;
    ip: string | null;
  }>(
    `SELECT id, extract(epoch FROM ts)::float8 AS ts, username, action, target, detail, ip
     FROM audit_log
     WHERE ($1::text IS NULL OR lower(username) = lower($1))
       AND ($2::text IS NULL OR action = $2 OR action LIKE $2 || '.%')
       AND ($3::text IS NULL OR strpos(lower(coalesce(target, '')), lower($3)) > 0)
       AND ($4::bigint IS NULL OR id < $4)
     ORDER BY id DESC
     LIMIT $5`,
    [user || null, action || null, q || null, before ?? null, limit + 1],
  );
  const list: AuditRow[] = rows.slice(0, limit).map((row) => ({ ...row, id: Number(row.id) }));
  return { rows: list, more: rows.length > limit };
}

/** Chi compare nel registro, per il filtro. */
export async function listAuditUsers() {
  const { rows } = await db().query<{ username: string }>(
    "SELECT DISTINCT username FROM audit_log WHERE username IS NOT NULL ORDER BY username LIMIT 200",
  );
  return rows.map((row) => row.username);
}

// Chiavi API

export interface ApiKeyRow {
  id: number;
  name: string;
  prefix: string;
  scope: "read" | "write";
  createdBy: string | null;
  createdAt: number;
  expiresAt: number | null;
  lastUsed: number | null;
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const { rows } = await db().query<{
    id: number;
    name: string;
    prefix: string;
    scope: ApiKeyRow["scope"];
    created_by: string | null;
    created_at: number;
    expires_at: number | null;
    last_used: number | null;
  }>(
    `SELECT k.id, k.name, k.prefix, k.scope, u.username AS created_by,
            extract(epoch FROM k.created_at)::float8 AS created_at,
            extract(epoch FROM k.expires_at)::float8 AS expires_at,
            extract(epoch FROM k.last_used)::float8 AS last_used
     FROM api_keys k LEFT JOIN users u ON u.id = k.created_by
     ORDER BY k.created_at DESC`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scope: row.scope,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsed: row.last_used,
  }));
}

// Inventario

export interface InventoryRow {
  id: number;
  name: string;
  address: string;
  sector: string;
  type: DeviceType;
  enabled: boolean;
  manufacturer: string | null;
  model: string | null;
  serial: string | null;
  firmware: string | null;
  location: string | null;
  owner: string | null;
  purchasedOn: string | null;
  warrantyUntil: string | null;
  note: string | null;
}

export async function getInventory(user: SessionUser): Promise<InventoryRow[]> {
  const visible = await visibleHostIds(user);
  const { rows } = await db().query<{
    id: number;
    name: string;
    address: string;
    group_name: string;
    device_type: DeviceType;
    enabled: boolean;
    manufacturer: string | null;
    model: string | null;
    serial: string | null;
    firmware: string | null;
    location: string | null;
    owner: string | null;
    purchased_on: string | null;
    warranty_until: string | null;
    inventory_note: string | null;
  }>(
    `SELECT id, name, address, group_name, device_type, enabled, manufacturer, model, serial, firmware, location,
            owner, inventory_note, to_char(purchased_on, 'YYYY-MM-DD') AS purchased_on,
            to_char(warranty_until, 'YYYY-MM-DD') AS warranty_until
     FROM hosts WHERE $1::int[] IS NULL OR id = ANY($1::int[])
     ORDER BY lower(group_name), lower(name)`,
    [visible],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    address: row.address,
    sector: row.group_name,
    type: row.device_type,
    enabled: row.enabled,
    manufacturer: row.manufacturer,
    model: row.model,
    serial: row.serial,
    firmware: row.firmware,
    location: row.location,
    owner: row.owner,
    purchasedOn: row.purchased_on,
    warrantyUntil: row.warranty_until,
    note: row.inventory_note,
  }));
}

// Pagina di stato

/** Gli stati come li vede chi non ha un account: niente sfumature tecniche. */
export type PublicStatus = "up" | "degraded" | "down" | "maintenance" | "unknown";

const PUBLIC_STATUS: Record<HostStatus, PublicStatus> = {
  online: "up",
  unstable: "degraded",
  offline: "down",
  unreachable: "down",
  maintenance: "maintenance",
  unknown: "unknown",
  paused: "unknown",
};

const STATUS_DAYS = 30;

export interface StatusComponent {
  id: number;
  label: string;
  status: PublicStatus;
  /** Percentuale nei 30 giorni, null se non c'è ancora storico. */
  uptime: number | null;
  /** Secondi fuori servizio per giorno, dal più vecchio. */
  days: number[];
  /** Indice del primo giorno in cui l'host esisteva: prima non ci sono dati. */
  from: number;
}

export interface StatusIncident {
  label: string;
  started: number;
  ended: number | null;
}

export interface StatusMaintenance {
  labels: string[];
  starts: number;
  ends: number;
}

export interface StatusPage {
  title: string;
  note: string;
  generatedAt: number;
  overall: PublicStatus;
  dayLabels: string[];
  components: StatusComponent[];
  incidents: StatusIncident[];
  maintenance: StatusMaintenance[];
}

/**
 * Null se la pagina è spenta. Solo gli host con un nome pubblico, e di loro solo quel nome:
 * niente indirizzi, settori o motivi interni.
 */
export async function getStatusPage(): Promise<StatusPage | null> {
  const [settings, alerts] = await Promise.all([getStatusSettings(), getAlertSettings()]);
  if (!settings.enabled) return null;

  const { rows: hosts } = await db().query<{ id: number; label: string; created_at: number }>(
    `SELECT id, public_label AS label, extract(epoch FROM created_at)::float8 AS created_at
     FROM hosts WHERE enabled AND public_label IS NOT NULL AND public_label <> ''
     ORDER BY lower(public_label) LIMIT 200`,
  );
  const ids = hosts.map((host) => host.id);
  const tz = alerts.timeZone;

  const [states, pinger, dayRows, downRows, incidentRows, maintenanceRows] = await Promise.all([
    getStatesOf(ids),
    getPingerStatus(),
    db().query<{ day: string; start: number }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, extract(epoch FROM d AT TIME ZONE $1)::float8 AS start
       FROM generate_series((now() AT TIME ZONE $1)::date - ${STATUS_DAYS - 1}, (now() AT TIME ZONE $1)::date,
                            interval '1 day') d
       ORDER BY d`,
      [tz],
    ),
    db().query<{ host_id: number; day: string; down: number }>(
      `WITH days AS (
         SELECT d::date AS day, d AT TIME ZONE $2 AS day_start, (d + interval '1 day') AT TIME ZONE $2 AS day_end
         FROM generate_series((now() AT TIME ZONE $2)::date - ${STATUS_DAYS - 1}, (now() AT TIME ZONE $2)::date,
                              interval '1 day') d
       )
       SELECT o.host_id, to_char(days.day, 'YYYY-MM-DD') AS day,
              sum(extract(epoch FROM least(coalesce(o.ended_at, now()), days.day_end, now())
                                   - greatest(o.started_at, days.day_start)))::float8 AS down
       FROM days
       JOIN outages o ON o.host_id = ANY($1::int[])
        AND o.started_at < days.day_end AND coalesce(o.ended_at, now()) > days.day_start
       WHERE NOT EXISTS (
         SELECT 1 FROM maintenance_hosts m
         WHERE m.host_id = o.host_id AND m.starts_at <= o.started_at AND m.ends_at >= coalesce(o.ended_at, now())
       )
       GROUP BY o.host_id, days.day`,
      [ids, tz],
    ),
    db().query<{ host_id: number; started: number; ended: number | null }>(
      `SELECT host_id, extract(epoch FROM started_at)::float8 AS started, extract(epoch FROM ended_at)::float8 AS ended
       FROM outages
       WHERE host_id = ANY($1::int[]) AND (ended_at IS NULL OR ended_at > now() - interval '7 days')
         AND coalesce(ended_at, now()) - started_at >= interval '1 minute'
       ORDER BY started_at DESC LIMIT 30`,
      [ids],
    ),
    db().query<{ window_id: number; host_id: number; starts: number; ends: number }>(
      `SELECT window_id, host_id, extract(epoch FROM starts_at)::float8 AS starts,
              extract(epoch FROM ends_at)::float8 AS ends
       FROM maintenance_hosts
       WHERE host_id = ANY($1::int[]) AND ends_at > now() AND starts_at < now() + interval '14 days'
       ORDER BY starts_at`,
      [ids],
    ),
  ]);

  const now = Date.now() / 1000;
  const labelOf = new Map(hosts.map((host) => [host.id, host.label]));
  const dayIndex = new Map(dayRows.rows.map((row, index) => [row.day, index]));
  const firstDay = dayRows.rows[0]?.start ?? now - STATUS_DAYS * 86_400;
  const down = new Map<number, number[]>(ids.map((id) => [id, Array(dayRows.rows.length).fill(0)]));
  for (const row of downRows.rows) {
    const index = dayIndex.get(row.day);
    if (index !== undefined) down.get(row.host_id)![index] = Math.max(0, row.down);
  }

  const components: StatusComponent[] = hosts.map((host) => {
    const days = down.get(host.id)!;
    const period = now - Math.max(firstDay, host.created_at);
    const total = days.reduce((sum, value) => sum + value, 0);
    // Senza il worker attivo lo stato non è affidabile: meglio dirlo che mostrare verde
    const status = pinger.healthy ? PUBLIC_STATUS[states.get(host.id) ?? "unknown"] : "unknown";
    return {
      id: host.id,
      label: host.label,
      status,
      uptime: period > 3600 ? Math.max(0, Math.min(100, 100 - (total / period) * 100)) : null,
      days,
      from: Math.max(0, dayRows.rows.findIndex((row) => row.start + 86_400 > host.created_at)),
    };
  });

  const windows = new Map<number, StatusMaintenance>();
  for (const row of maintenanceRows.rows) {
    const window = windows.get(row.window_id) ?? { labels: [], starts: row.starts, ends: row.ends };
    const label = labelOf.get(row.host_id);
    if (label && !window.labels.includes(label)) window.labels.push(label);
    windows.set(row.window_id, window);
  }

  const rank: PublicStatus[] = ["down", "degraded", "maintenance", "unknown", "up"];
  const overall = components.length
    ? rank.find((status) => components.some((component) => component.status === status))!
    : "unknown";

  return {
    title: settings.title,
    note: settings.note,
    generatedAt: now,
    overall,
    dayLabels: dayRows.rows.map((row) => row.day),
    components,
    incidents: incidentRows.rows.map((row) => ({
      label: labelOf.get(row.host_id) ?? "",
      started: row.started,
      ended: row.ended,
    })),
    maintenance: [...windows.values()],
  };
}

// Salute

export async function getHealth() {
  try {
    const pinger = await getPingerStatus();
    return { ok: pinger.healthy, database: true, pinger: { healthy: pinger.healthy, lastRun: pinger.lastBeat } };
  } catch {
    return { ok: false, database: false, pinger: { healthy: false, lastRun: null } };
  }
}

// Account

export async function getTotpState(user: SessionUser) {
  const { rows } = await db().query<{ enabled: boolean; codes: number }>(
    "SELECT totp_enabled AS enabled, coalesce(cardinality(recovery_codes), 0) AS codes FROM users WHERE id = $1",
    [user.id],
  );
  return { enabled: rows[0]?.enabled ?? false, recoveryLeft: rows[0]?.codes ?? 0 };
}
