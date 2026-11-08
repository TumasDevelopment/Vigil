import pg from "pg";
import { hostDownAlert, hostStillDownAlert, hostUpAlert, insertAlerts, serviceAlert } from "./alerts.mjs";
import { isDue, nextCheckState, reachabilityFromChecks, runCheck } from "./checks.mjs";
import { findCause, hostHealth } from "./dependencies.mjs";
import { scanAddresses } from "./discovery.mjs";
import { addressList, parseSubnet } from "../lib/subnet.mjs";
import { pingHost } from "./ping.mjs";
import { nextState } from "./state.mjs";
import { runRetentionIfDue } from "./retention.mjs";
import { collectServerHealth, metricRow, serverObservations, trackProblems } from "./server-health.mjs";
import { collectSystemFacts } from "./system-facts.mjs";

try {
  process.loadEnvFile(".env");
} catch {
  // In test le variabili arrivano dall'ambiente
}

const INTERVAL_MS = Number(process.env.PING_INTERVAL_SECONDS ?? 10) * 1000;
const OFFLINE_AFTER = Number(process.env.OFFLINE_AFTER_FAILURES ?? 2);
const CHECK_MS = Number(process.env.CHECK_INTERVAL_SECONDS ?? 30) * 1000;
const SERVER_MS = Number(process.env.SERVER_SAMPLE_SECONDS ?? 60) * 1000;
const CYCLE_DAYS = Number(process.env.RETENTION_CYCLE_DAYS ?? 14);
const KEEP_DAYS = Number(process.env.RETENTION_KEEP_DAYS ?? 7);
const CERT_MS = 3_600_000;
const CONCURRENCY = 32;
const CHECK_CONCURRENCY = 16;
const HOUSEKEEPING_MS = 3_600_000;
const DISCOVERY_MS = 3000;
const DISCOVERY_KEEP = 5;
// Sistema operativo, hardware e versioni cambiano di rado: basta rileggerli ogni 6 ore
const FACTS_MS = 6 * 3_600_000;
const ACTIVE_MAINTENANCE = "SELECT DISTINCT host_id FROM maintenance_hosts WHERE starts_at <= now() AND ends_at > now()";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
pool.on("error", (error) => console.error("Errore connessione database:", error.message));

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await work(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const saveSystemState = (client, key, value) =>
  client.query(
    `INSERT INTO system_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );

/**
 * Gli host senza ping prendono lo stato dai loro controlli. Senza controlli restano senza dati.
 * `links` li comprende tutti: un dispositivo in pausa resta un anello della catena.
 */
async function loadHosts() {
  const { rows: all } = await pool.query(
    `SELECT h.id, h.name, h.address, h.group_name, h.enabled, h.ping_enabled, h.parent_id,
            s.status, s.since, s.fail_streak, s.fail_since,
            o.id AS outage_id, o.alerted AS outage_alerted, o.cause_host_id AS outage_cause
     FROM hosts h
     LEFT JOIN host_state s ON s.host_id = h.id
     LEFT JOIN outages o ON o.host_id = h.id AND o.ended_at IS NULL`,
  );
  const links = all.map((host) => ({ id: host.id, parentId: host.parent_id }));
  const rows = all.filter((host) => host.enabled);

  const silent = rows.filter((host) => !host.ping_enabled).map((host) => host.id);
  if (silent.length === 0) return { hosts: rows, fromChecks: new Map(), links };

  const { rows: checks } = await pool.query(
    "SELECT host_id, kind, status, last_ms FROM service_checks WHERE host_id = ANY($1::int[])",
    [silent],
  );
  const fromChecks = new Map(
    silent.map((id) => [id, reachabilityFromChecks(checks.filter((check) => check.host_id === id))]),
  );
  return { hosts: rows.filter((host) => host.ping_enabled || fromChecks.get(host.id)), fromChecks, links };
}

async function runCycle() {
  const startedAt = Date.now();
  const ts = new Date(Math.floor(startedAt / 1000) * 1000);

  const { hosts, fromChecks, links } = await loadHosts();
  const results = await mapLimit(hosts, CONCURRENCY, (host) =>
    host.ping_enabled ? pingHost(host.address) : fromChecks.get(host.id),
  );

  const states = hosts.map((host, index) =>
    nextState(
      host.status
        ? { status: host.status, since: host.since, failStreak: host.fail_streak, failSince: host.fail_since }
        : null,
      results[index],
      ts,
      OFFLINE_AFTER,
    ),
  );

  // Dal nuovo stato di tutti: uno switch e chi gli sta dietro cadono nello stesso ciclo
  const nodes = new Map(links.map((link) => [link.id, { parentId: link.parentId, health: "unknown" }]));
  hosts.forEach((host, index) => {
    nodes.get(host.id).health = hostHealth(states[index], ts);
  });
  const dependentsOf = (id) =>
    hosts.filter((host) => nodes.get(host.id).health === "down" && findCause(host.id, nodes) === id).length;

  await inTransaction(async (client) => {
    if (hosts.length > 0) {
      const ids = hosts.map((host) => host.id);

      // Il JOIN scarta gli host eliminati o messi in pausa mentre il ciclo era in corso
      await client.query(
        `INSERT INTO ping_results (host_id, ts, online, sent, received, rtt_min, rtt_avg, rtt_max)
         SELECT u.id, $1, u.received > 0, u.sent, u.received, u.lo, u.avg, u.hi
         FROM unnest($2::int[], $3::smallint[], $4::smallint[], $5::real[], $6::real[], $7::real[])
              AS u(id, sent, received, lo, avg, hi)
         JOIN hosts h ON h.id = u.id AND h.enabled
         ON CONFLICT DO NOTHING`,
        [
          ts,
          ids,
          results.map((r) => r.sent),
          results.map((r) => r.received),
          results.map((r) => r.rttMin),
          results.map((r) => r.rttAvg),
          results.map((r) => r.rttMax),
        ],
      );

      await client.query(
        `INSERT INTO host_state (host_id, status, since, last_check, last_rtt, last_loss, fail_streak, fail_since)
         SELECT u.id, u.status, u.since, $1, u.rtt, u.loss, u.streak, u.fail_since
         FROM unnest($2::int[], $3::text[], $4::timestamptz[], $5::real[], $6::real[], $7::int[], $8::timestamptz[])
              AS u(id, status, since, rtt, loss, streak, fail_since)
         JOIN hosts h ON h.id = u.id AND h.enabled
         ON CONFLICT (host_id) DO UPDATE SET
           status = EXCLUDED.status, since = EXCLUDED.since, last_check = EXCLUDED.last_check,
           last_rtt = EXCLUDED.last_rtt, last_loss = EXCLUDED.last_loss,
           fail_streak = EXCLUDED.fail_streak, fail_since = EXCLUDED.fail_since`,
        [
          ts,
          ids,
          states.map((s) => s.status),
          states.map((s) => s.since),
          results.map((r) => r.rttAvg),
          results.map((r) => (r.sent > 0 ? 100 * (1 - r.received / r.sent) : 100)),
          states.map((s) => s.failStreak),
          states.map((s) => s.failSince),
        ],
      );

      await client.query(
        `UPDATE host_state s SET rtt_1m = w.rtt, loss_1m = w.loss
         FROM (SELECT host_id, avg(rtt_avg) AS rtt,
                      100 * (1 - sum(received)::real / nullif(sum(sent), 0)) AS loss
               FROM ping_results
               WHERE host_id = ANY($1::int[]) AND ts > $2::timestamptz - interval '1 minute'
               GROUP BY host_id) w
         WHERE s.host_id = w.host_id`,
        [ids, ts],
      );

      const { rows: windows } = await client.query(ACTIVE_MAINTENANCE);
      const inMaintenance = new Set(windows.map((row) => row.host_id));

      const alerts = [];
      for (let index = 0; index < hosts.length; index++) {
        const host = hosts[index];
        const { status, since, openOutageAt, closeOutageAt } = states[index];
        const planned = inMaintenance.has(host.id);
        const cause = findCause(host.id, nodes);

        if (openOutageAt) {
          const alerted = !planned && cause === null;
          await client.query(
            `INSERT INTO outages (host_id, started_at, alerted, cause_host_id)
             SELECT id, $2, $3, $4 FROM hosts WHERE id = $1 AND enabled
             ON CONFLICT DO NOTHING`,
            [host.id, openOutageAt, alerted, cause],
          );
          if (alerted) alerts.push(hostDownAlert(host, dependentsOf(host.id)));
          else if (!planned) alerts.push({ ...hostDownAlert(host), causedBy: cause });
        } else if (closeOutageAt) {
          await client.query("UPDATE outages SET ended_at = $2 WHERE host_id = $1 AND ended_at IS NULL", [
            host.id,
            closeOutageAt,
          ]);
          const back = hostUpAlert(host, (closeOutageAt.getTime() - new Date(host.since).getTime()) / 1000);
          if (host.outage_alerted !== false) alerts.push(back);
          else if (host.outage_cause !== null) alerts.push({ ...back, causedBy: host.outage_cause });
        } else if (status === "offline" && host.outage_id) {
          const overdue = !host.outage_alerted && !planned && cause === null;
          if (overdue) alerts.push(hostStillDownAlert(host, (ts.getTime() - new Date(since).getTime()) / 1000));
          if (overdue || cause !== host.outage_cause) {
            await client.query(
              "UPDATE outages SET alerted = alerted OR $2, cause_host_id = $3 WHERE host_id = $1 AND ended_at IS NULL",
              [host.id, overdue, cause],
            );
          }
        }
      }
      await insertAlerts(client, alerts);
    }

    await saveSystemState(client, "pinger", { durationMs: Date.now() - startedAt, hosts: hosts.length });
  });
}

async function runChecks() {
  const now = new Date();
  const { rows } = await pool.query(
    `SELECT c.id, c.host_id, c.name, c.kind, c.port, c.url, c.warn_days, c.status, c.since, c.last_check,
            c.fail_streak, c.fail_since, c.alerted, h.name AS host_name, h.address
     FROM service_checks c
     JOIN hosts h ON h.id = c.host_id AND h.enabled`,
  );

  const due = rows.filter((check) => isDue(check, now, CHECK_MS, CERT_MS));
  if (due.length === 0) return;

  const results = await mapLimit(due, CHECK_CONCURRENCY, (check) => runCheck(check, now));
  const ts = new Date();

  await inTransaction(async (client) => {
    // Letto adesso: mentre i controlli giravano l'host può essere caduto
    const { rows: states } = await client.query(
      `SELECT h.id, h.parent_id, s.status, s.since, s.fail_streak
       FROM hosts h LEFT JOIN host_state s ON s.host_id = h.id`,
    );
    const nodes = new Map(
      states.map((host) => [
        host.id,
        {
          parentId: host.parent_id,
          health: hostHealth({ status: host.status, since: host.since, failStreak: host.fail_streak }, ts),
        },
      ]),
    );
    const { rows: windows } = await client.query(ACTIVE_MAINTENANCE);
    const inMaintenance = new Set(windows.map((row) => row.host_id));

    // Con l'host giù, o in manutenzione, il guasto di un servizio è una conseguenza: non serve un avviso suo
    const explained = (hostId) =>
      inMaintenance.has(hostId) || nodes.get(hostId)?.health === "down" || findCause(hostId, nodes) !== null;

    const alerts = [];
    for (let index = 0; index < due.length; index++) {
      const check = due[index];
      const result = results[index];
      const state = nextCheckState(
        { status: check.status, since: check.since, failStreak: check.fail_streak, failSince: check.fail_since },
        result,
        ts,
        OFFLINE_AFTER,
      );

      let alerted = check.alerted;
      if (state.status === "failed" && !alerted && !explained(check.host_id)) {
        alerts.push(serviceAlert(check, "failed", result.detail));
        alerted = true;
      } else if (state.event === "recovered") {
        if (alerted) alerts.push(serviceAlert(check, "recovered", result.detail));
        alerted = false;
      } else if (state.event === "warned") {
        alerts.push(serviceAlert(check, "warned", result.detail));
      }

      await client.query(
        `UPDATE service_checks
         SET status = $2, since = $3, last_check = $4, last_ms = $5, detail = $6,
             fail_streak = $7, fail_since = $8, alerted = $9
         WHERE id = $1`,
        [
          check.id,
          state.status,
          state.since,
          ts,
          result.ms,
          result.detail,
          state.failStreak,
          state.failSince,
          alerted,
        ],
      );
      if (state.openOutageAt) {
        await client.query(
          `INSERT INTO service_outages (check_id, started_at)
           SELECT id, $2 FROM service_checks WHERE id = $1
           ON CONFLICT DO NOTHING`,
          [check.id, state.openOutageAt],
        );
      }
      if (state.closeOutageAt) {
        await client.query("UPDATE service_outages SET ended_at = $2 WHERE check_id = $1 AND ended_at IS NULL", [
          check.id,
          state.closeOutageAt,
        ]);
      }
    }
    await insertAlerts(client, alerts);
  });
}

async function sampleServer() {
  const health = await collectServerHealth();
  const metrics = metricRow(health);
  const { rows } = await pool.query("SELECT value FROM system_state WHERE key = 'server_problems'");
  const { state, alerts } = trackProblems(rows[0]?.value, serverObservations(health));

  await inTransaction(async (client) => {
    await client.query(
      `INSERT INTO server_metrics (ts, cpu_pct, mem_pct, swap_pct, disk_pct, load1)
       VALUES (date_trunc('second', now()), $1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [metrics.cpu, metrics.mem, metrics.swap, metrics.disk, metrics.load],
    );
    await saveSystemState(client, "server_health", health);
    await saveSystemState(client, "server_problems", state);
    await insertAlerts(client, alerts);
  });
}

/** Esegue la ricerca in coda, se ce n'è una. `repeat` non si sovrappone: una alla volta. */
async function runDiscovery() {
  const { rows } = await pool.query(
    `UPDATE discovery_scans SET status = 'running'
     WHERE id = (SELECT id FROM discovery_scans WHERE status = 'queued' ORDER BY id LIMIT 1)
     RETURNING id, subnet`,
  );
  const scan = rows[0];
  if (!scan) return;

  // "AND status = 'running'": se nel frattempo è stata annullata, resta annullata
  const finish = (fields, value) =>
    pool.query(`UPDATE discovery_scans SET ${fields}, finished_at = now() WHERE id = $1 AND status = 'running'`, [
      scan.id,
      value,
    ]);

  try {
    const subnet = parseSubnet(scan.subnet, { allowLoopback: process.env.DISCOVERY_ALLOW_LOOPBACK === "1" });
    if (subnet.error) throw new Error(subnet.error);
    const addresses = addressList(subnet);
    await pool.query("UPDATE discovery_scans SET total = $2 WHERE id = $1", [scan.id, addresses.length]);

    const found = await scanAddresses(addresses, async (checked) => {
      const { rowCount } = await pool.query(
        "UPDATE discovery_scans SET checked = $2 WHERE id = $1 AND status = 'running'",
        [scan.id, checked],
      );
      return rowCount > 0;
    });
    if (found) await finish("status = 'done', checked = total, found = $2", JSON.stringify(found));
  } catch (error) {
    await finish("status = 'failed', error = $2", error.message);
  }
  await pool.query(
    "DELETE FROM discovery_scans WHERE id NOT IN (SELECT id FROM discovery_scans ORDER BY id DESC LIMIT $1)",
    [DISCOVERY_KEEP],
  );
}

async function saveSystemFacts() {
  await saveSystemState(pool, "system_facts", await collectSystemFacts());
}

async function closeInterruptedScans() {
  await pool
    .query(
      `UPDATE discovery_scans SET status = 'failed', error = 'Interrotta da un riavvio del worker.', finished_at = now()
       WHERE status = 'running'`,
    )
    .catch((error) => console.error("Ricerche interrotte:", error.message));
}

async function housekeeping() {
  const outcome = await runRetentionIfDue(pool, { cycleDays: CYCLE_DAYS, keepDays: KEEP_DAYS });
  if (outcome.ran) {
    console.log(`Pulizia: ${outcome.pingRows} ping e ${outcome.outageRows} interruzioni cancellati`);
  }
  await pool.query("DELETE FROM sessions WHERE expires_at < now()");
}

let stopping = false;
let timer;

function scheduleNext() {
  if (stopping) return;
  // Allineato ai multipli dell'intervallo, così i campioni restano regolari
  timer = setTimeout(tick, INTERVAL_MS - (Date.now() % INTERVAL_MS));
}

async function tick() {
  try {
    await runCycle();
  } catch (error) {
    console.error("Ciclo di ping fallito:", error.message);
  }
  scheduleNext();
}

/** Ripete `work` senza sovrapporsi: un giro lento fa solo slittare il successivo. */
function repeat(label, intervalMs, work) {
  const run = async () => {
    try {
      await work();
    } catch (error) {
      console.error(`${label} fallito:`, error.message);
    }
    if (!stopping) setTimeout(run, intervalMs);
  };
  run();
}

async function safeHousekeeping() {
  try {
    await housekeeping();
  } catch (error) {
    console.error("Manutenzione fallita:", error.message);
  }
}

async function shutdown() {
  stopping = true;
  clearTimeout(timer);
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(`Worker avviato: ping ogni ${INTERVAL_MS / 1000} s, controlli ogni ${CHECK_MS / 1000} s`);
await safeHousekeeping();
await closeInterruptedScans();
setInterval(safeHousekeeping, HOUSEKEEPING_MS);
scheduleNext();
repeat("Controllo servizi", CHECK_MS, runChecks);
repeat("Campione del server", SERVER_MS, sampleServer);
repeat("Ricerca dei dispositivi", DISCOVERY_MS, runDiscovery);
repeat("Dati di sistema", FACTS_MS, saveSystemFacts);
