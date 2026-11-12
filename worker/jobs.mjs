// I lavori periodici aggiunti con la versione "enterprise": ore di silenzio, escalation,
// battito verso un servizio esterno, scadenze di domini e garanzie, report mensile, backup.
import { afterQuietAlert, escalationAlert, insertAlerts } from "./alerts.mjs";
import { listBackups, pgDumpVersion, runBackup } from "./backup.mjs";
import { checkDomain } from "./domains.mjs";
import { collectReport, monthLabel, previousMonth, renderReport } from "../lib/report.mjs";
import { isQuietTime, normalizeAlertSettings } from "../lib/settings.mjs";

const SETTINGS_TTL_MS = 30_000;
const IN_MAINTENANCE = (column) =>
  `EXISTS (SELECT 1 FROM maintenance_hosts m WHERE m.host_id = ${column} AND m.starts_at <= now() AND m.ends_at > now())`;
const dateFormat = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

let settingsCache = { at: 0, value: null };

/** Le impostazioni degli avvisi, rilette al massimo ogni 30 secondi. */
export async function alertSettings(pool) {
  if (settingsCache.value && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.value;
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'alerts'");
  settingsCache = { at: Date.now(), value: normalizeAlertSettings(rows[0]?.value) };
  return settingsCache.value;
}

export const quietNow = async (pool, now = new Date()) => isQuietTime(now, await alertSettings(pool));

const seconds = (row) => Number(row.seconds) || 0;

/**
 * Finito il silenzio, ripropone ai PC i guasti nati di notte e ancora aperti, una volta sola:
 * dopo, esiste un avviso non silenziato e la condizione non vale più. Riparte anche il conto dell'escalation.
 */
export async function runAfterQuiet(pool, inTransaction) {
  const settings = await alertSettings(pool);
  if (!settings.quietEnabled || isQuietTime(new Date(), settings)) return;
  await inTransaction(async (client) => {
    const { rows: hosts } = await client.query(
      `UPDATE outages o SET tier_since = now()
       FROM hosts h
       WHERE h.id = o.host_id AND h.enabled AND o.ended_at IS NULL AND o.alerted
         AND o.ack_at IS NULL AND o.cause_host_id IS NULL AND NOT ${IN_MAINTENANCE("h.id")}
         AND EXISTS (SELECT 1 FROM alerts a WHERE a.host_id = o.host_id AND a.check_id IS NULL
                     AND a.quiet AND a.level = 'problem' AND a.ts >= o.started_at)
         AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.host_id = o.host_id AND a.check_id IS NULL
                         AND NOT a.quiet AND a.level = 'problem' AND a.caused_by IS NULL AND a.ts >= o.started_at)
       RETURNING o.host_id, o.tier, h.name, h.address, h.group_name,
                 extract(epoch FROM now() - o.started_at) AS seconds`,
    );
    const { rows: services } = await client.query(
      `UPDATE service_outages so SET tier_since = now()
       FROM service_checks c JOIN hosts h ON h.id = c.host_id AND h.enabled
       WHERE c.id = so.check_id AND so.ended_at IS NULL AND so.ack_at IS NULL AND c.alerted
         AND NOT ${IN_MAINTENANCE("h.id")}
         AND EXISTS (SELECT 1 FROM alerts a WHERE a.check_id = so.check_id
                     AND a.quiet AND a.level = 'problem' AND a.ts >= so.started_at)
         AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.check_id = so.check_id
                         AND NOT a.quiet AND a.level = 'problem' AND a.ts >= so.started_at)
       RETURNING so.check_id, so.tier, c.host_id, c.name, h.name AS host_name,
                 extract(epoch FROM now() - so.started_at) AS seconds`,
    );
    await insertAlerts(client, [
      ...hosts.map((row) =>
        afterQuietAlert({
          hostId: row.host_id,
          name: row.name,
          tier: row.tier,
          seconds: seconds(row),
          place: [row.address, row.group_name].filter(Boolean).join(" · "),
        }),
      ),
      ...services.map((row) =>
        afterQuietAlert({
          hostId: row.host_id,
          checkId: row.check_id,
          name: `${row.name} su ${row.host_name}`,
          tier: row.tier,
          seconds: seconds(row),
        }),
      ),
    ]);
  });
}

/**
 * Un guasto che nessuno prende in carico entro X minuti sale di livello e arriva anche a chi
 * ha un livello più alto. Nelle ore di silenzio gli host non critici aspettano il mattino.
 */
export async function runEscalation(pool, inTransaction) {
  const settings = await alertSettings(pool);
  if (settings.escalationMinutes <= 0) return;
  const { rows } = await pool.query("SELECT coalesce(max(alert_tier), 1) AS top FROM users");
  const top = Number(rows[0].top);
  if (top <= 1) return;
  const quiet = isQuietTime(new Date(), settings);
  const params = [top, settings.escalationMinutes, quiet];

  await inTransaction(async (client) => {
    const { rows: hosts } = await client.query(
      `UPDATE outages o SET tier = o.tier + 1, tier_since = now()
       FROM hosts h
       WHERE h.id = o.host_id AND h.enabled AND o.ended_at IS NULL AND o.alerted
         AND o.ack_at IS NULL AND o.cause_host_id IS NULL AND o.tier < $1
         AND coalesce(o.tier_since, o.started_at) <= now() - make_interval(mins => $2::int)
         AND NOT ($3::boolean AND NOT h.critical) AND NOT ${IN_MAINTENANCE("h.id")}
       RETURNING o.host_id, o.tier, h.name, extract(epoch FROM now() - o.started_at) AS seconds`,
      params,
    );
    // Con l'host giù conta l'interruzione dell'host, non quella dei suoi servizi
    const { rows: services } = await client.query(
      `UPDATE service_outages so SET tier = so.tier + 1, tier_since = now()
       FROM service_checks c JOIN hosts h ON h.id = c.host_id AND h.enabled
       WHERE c.id = so.check_id AND so.ended_at IS NULL AND so.ack_at IS NULL
         AND c.alerted AND c.status = 'failed' AND so.tier < $1
         AND coalesce(so.tier_since, so.started_at) <= now() - make_interval(mins => $2::int)
         AND NOT ($3::boolean AND NOT h.critical) AND NOT ${IN_MAINTENANCE("h.id")}
         AND NOT EXISTS (SELECT 1 FROM outages o WHERE o.host_id = h.id AND o.ended_at IS NULL)
       RETURNING so.check_id, so.tier, c.host_id, c.name, h.name AS host_name,
                 extract(epoch FROM now() - so.started_at) AS seconds`,
      params,
    );
    await insertAlerts(client, [
      ...hosts.map((row) => escalationAlert({ hostId: row.host_id, name: row.name, tier: row.tier, seconds: seconds(row) })),
      ...services.map((row) =>
        escalationAlert({
          hostId: row.host_id,
          checkId: row.check_id,
          name: `${row.name} su ${row.host_name}`,
          tier: row.tier,
          seconds: seconds(row),
        }),
      ),
    ]);
  });
}

/**
 * Battito verso un servizio esterno (Healthchecks, Uptime Kuma in modalità push, ecc.):
 * se smette di arrivare, è quel servizio ad accorgersi che Vigil è fermo.
 */
export function createHeartbeat(rawUrl) {
  let url = null;
  try {
    const parsed = rawUrl ? new URL(rawUrl) : null;
    if (parsed && (parsed.protocol === "https:" || parsed.protocol === "http:")) url = parsed.toString();
    else if (parsed) console.error("HEARTBEAT_URL ignorato: serve un indirizzo http o https");
  } catch {
    console.error("HEARTBEAT_URL ignorato: non è un indirizzo valido");
  }
  let lastSent = 0;
  let lastError = 0;
  return function beat() {
    if (!url || Date.now() - lastSent < 60_000) return;
    lastSent = Date.now();
    fetch(url, { method: "GET", signal: AbortSignal.timeout(10_000), redirect: "follow" })
      .then((response) => response.body?.cancel())
      .catch((error) => {
        // Un solo messaggio ogni 10 minuti: con il servizio irraggiungibile il log non si riempie
        if (Date.now() - lastError > 600_000) {
          lastError = Date.now();
          console.error("Battito non inviato:", error.message);
        }
      });
  };
}

/** Scadenza dei domini: ognuno riletto una volta al giorno (ogni 6 ore se l'ultima lettura è fallita). */
export async function runDomainChecks(pool) {
  const { rows } = await pool.query(
    `SELECT id, name FROM domains
     WHERE checked_at IS NULL OR checked_at < now() - interval '24 hours'
        OR (error IS NOT NULL AND checked_at < now() - interval '6 hours')
     ORDER BY checked_at NULLS FIRST LIMIT 10`,
  );
  for (const domain of rows) {
    try {
      const result = await checkDomain(domain.name);
      await pool.query(
        `UPDATE domains SET expires_at = $2, registrar = $3, source = $4, checked_at = now(), error = NULL
         WHERE id = $1`,
        [domain.id, result.expiresAt, result.registrar, result.source],
      );
    } catch (error) {
      await pool.query("UPDATE domains SET checked_at = now(), error = $2 WHERE id = $1", [
        domain.id,
        String(error.message).slice(0, 300),
      ]);
    }
  }

  // Un avviso per ogni data di scadenza: dopo il rinnovo la data cambia e l'avviso potrà tornare
  const { rows: expiring } = await pool.query(
    `UPDATE domains SET alerted_for = expires_at::date
     WHERE expires_at IS NOT NULL AND expires_at <= now() + make_interval(days => warn_days)
       AND alerted_for IS DISTINCT FROM expires_at::date
     RETURNING name, expires_at`,
  );
  if (expiring.length === 0) return;
  await insertAlerts(
    pool,
    expiring.map((row) => {
      const expired = new Date(row.expires_at).getTime() <= Date.now();
      const date = dateFormat.format(new Date(row.expires_at));
      return {
        hostId: null,
        level: expired ? "problem" : "warning",
        title: expired ? `Il dominio ${row.name} è scaduto` : `Il dominio ${row.name} sta per scadere`,
        body: expired ? `Scaduto il ${date}` : `Scade il ${date}: rinnovalo dal registrar`,
      };
    }),
  );
}

/** Garanzie in scadenza dall'inventario. Non di notte: l'avviso andrebbe perso tra quelli silenziati. */
export async function runWarrantyChecks(pool) {
  const settings = await alertSettings(pool);
  if (isQuietTime(new Date(), settings)) return;
  const { rows } = await pool.query(
    `UPDATE hosts SET warranty_alerted_for = warranty_until
     WHERE warranty_until IS NOT NULL AND warranty_until <= current_date + $1::int
       AND warranty_alerted_for IS DISTINCT FROM warranty_until
     RETURNING id, name, warranty_until, warranty_until < current_date AS expired`,
    [settings.warrantyDays],
  );
  if (rows.length === 0) return;
  await insertAlerts(
    pool,
    rows.map((row) => {
      const date = dateFormat.format(new Date(`${toDateText(row.warranty_until)}T00:00:00Z`));
      return {
        hostId: row.id,
        level: "warning",
        title: row.expired ? `Garanzia di ${row.name} scaduta` : `Garanzia di ${row.name} in scadenza`,
        body: row.expired ? `Scaduta il ${date}` : `Scade il ${date}`,
      };
    }),
  );
}

/** pg restituisce le colonne date come Date a mezzanotte locale: qui serve solo AAAA-MM-GG. */
function toDateText(value) {
  if (typeof value === "string") return value.slice(0, 10);
  const pad = (number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** Il report del mese appena chiuso, salvato una volta sola (il PDF dei mesi passati non cambia più). */
export async function runMonthlyReport(pool) {
  const { timeZone } = await alertSettings(pool);
  const month = previousMonth(new Date(), timeZone);
  const { rowCount } = await pool.query("SELECT 1 FROM reports WHERE month = $1::date", [`${month}-01`]);
  if (rowCount > 0) return;
  const summary = await collectReport((sql, params) => pool.query(sql, params).then((result) => result.rows), {
    month,
    timeZone,
  });
  const pdf = renderReport(summary);
  await pool.query(
    "INSERT INTO reports (month, summary, pdf) VALUES ($1::date, $2, $3) ON CONFLICT (month) DO NOTHING",
    [`${month}-01`, JSON.stringify(summary), pdf],
  );
  console.log(`Report di ${monthLabel(month)} generato (${Math.round(pdf.length / 1024)} KB)`);
}

const saveState = (pool, key, value) =>
  pool.query(
    `INSERT INTO system_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );

/**
 * Backup ogni 24 ore, oppure subito se un amministratore l'ha chiesto dalla pagina Impostazioni
 * (riga 'backup_request' in system_state). Dopo un errore riprova tra un'ora.
 */
export async function runBackupIfDue(pool, { databaseUrl, dir, keep }) {
  const { rows } = await pool.query(
    "SELECT key, value, updated_at FROM system_state WHERE key IN ('backup', 'backup_request')",
  );
  const state = rows.find((row) => row.key === "backup")?.value ?? {};
  const request = rows.find((row) => row.key === "backup_request");
  const now = Date.now();
  const lastAttempt = state.lastAttemptAt ? Date.parse(state.lastAttemptAt) : 0;
  const lastSuccess = state.lastSuccessAt ? Date.parse(state.lastSuccessAt) : 0;
  const requested = request && new Date(request.updated_at).getTime() > lastAttempt;
  const due = state.error ? now - lastAttempt >= 3_600_000 : now - lastSuccess >= 86_400_000;
  if (!requested && !due) return;

  const base = { dir, keep, pgDump: await pgDumpVersion(), lastAttemptAt: new Date().toISOString() };
  await saveState(pool, "backup", { ...state, ...base, running: true });
  try {
    const result = await runBackup({ databaseUrl, dir, keep });
    await saveState(pool, "backup", {
      ...base,
      running: false,
      lastSuccessAt: new Date().toISOString(),
      file: result.file,
      bytes: result.bytes,
      durationMs: result.durationMs,
      files: await listBackups(dir),
      error: null,
    });
    if (state.error) {
      await insertAlerts(pool, [
        { hostId: null, level: "resolved", title: "Backup del database di nuovo riuscito", body: result.file },
      ]);
    }
  } catch (error) {
    await saveState(pool, "backup", {
      ...state,
      ...base,
      running: false,
      error: error.message,
      files: await listBackups(dir).catch(() => state.files ?? []),
    });
    if (!state.error) {
      await insertAlerts(pool, [
        { hostId: null, level: "problem", title: "Backup del database non riuscito", body: error.message },
      ]);
    }
    throw error;
  } finally {
    if (request) await pool.query("DELETE FROM system_state WHERE key = 'backup_request'");
  }
}
