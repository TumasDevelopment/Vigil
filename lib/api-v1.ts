import "server-only";
import type { HostSummary, OutageRow } from "./types";

// Forme pubbliche dell'API v1: date in ISO, nomi stabili anche se cambiano i tipi interni.

export const iso = (seconds: number | null) => (seconds === null ? null : new Date(seconds * 1000).toISOString());

export const hostView = (host: HostSummary) => ({
  id: host.id,
  name: host.name,
  address: host.address,
  sector: host.sector,
  type: host.type,
  enabled: host.enabled,
  status: host.status,
  since: iso(host.since),
  lastCheck: iso(host.lastCheck),
  rttMs: host.rtt,
  lossPct: host.loss,
  reason: host.reason,
  maintenanceUntil: iso(host.maintenanceUntil),
  parentId: host.parentId,
});

export const outageView = (outage: OutageRow) => ({
  id: outage.id,
  kind: outage.service === null ? "host" : "service",
  hostId: outage.hostId,
  hostName: outage.hostName,
  service: outage.service,
  started: iso(outage.started),
  ended: iso(outage.ended),
  cause: outage.causeName,
  inMaintenance: outage.inMaintenance,
  ackBy: outage.ackBy,
  ackAt: iso(outage.ackAt),
  note: outage.note,
});

/** Un id da URL o da JSON: intero positivo, altrimenti null. */
export function rowId(value: unknown) {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number > 0 && number <= 2_147_483_647
    ? number
    : null;
}

/** Testo da un corpo JSON: "" se manca, undefined se non è una stringa. */
export function field(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : undefined;
}

/** Numero da un corpo JSON entro i limiti. null se manca, undefined se non valido. */
export function numberField(body: Record<string, unknown>, key: string, min: number, max: number) {
  const value = body[key];
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

/** true/false da un corpo JSON. null se manca, undefined se non è un booleano. */
export function flagField(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value === undefined || value === null) return null;
  return typeof value === "boolean" ? value : undefined;
}
