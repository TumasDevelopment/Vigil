const DAY_MS = 86_400_000;
const BATCH_ROWS = 50_000;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ogni `cycleDays` giorni cancella i dati più vecchi di `keepDays`.
 * Con 14 e 7: ogni due settimane sparisce la prima, resta la seconda.
 * La data dell'ultima pulizia sta nel database, quindi i riavvii non azzerano il conteggio.
 * Le interruzioni ancora in corso non vengono mai cancellate.
 */
export async function runRetentionIfDue(pool, { cycleDays, keepDays, historyDays = keepDays, auditDays = 365, now = new Date() }) {
  const { rows } = await pool.query("SELECT value FROM system_state WHERE key = 'last_cleanup'");

  if (rows.length === 0) {
    await saveLastCleanup(pool, now);
    return { ran: false, reason: "primo avvio: conteggio iniziato" };
  }

  const last = new Date(rows[0].value.at);
  if (now.getTime() - last.getTime() < cycleDays * DAY_MS) {
    return { ran: false, reason: "non ancora dovuta" };
  }

  const cutoff = new Date(now.getTime() - keepDays * DAY_MS);
  // Le interruzioni sono poche righe e servono al report mensile e alla pagina di stato:
  // si tengono più a lungo dei ping
  const historyCutoff = new Date(now.getTime() - Math.max(keepDays, historyDays) * DAY_MS);

  // A blocchi, così gli inserimenti del ciclo di ping non restano in attesa
  let pingRows = 0;
  for (;;) {
    const { rowCount } = await pool.query(
      `DELETE FROM ping_results WHERE ctid = ANY (ARRAY(
         SELECT ctid FROM ping_results WHERE ts < $1 LIMIT $2
       ))`,
      [cutoff, BATCH_ROWS],
    );
    pingRows += rowCount;
    if (rowCount < BATCH_ROWS) break;
    await pause(100);
  }

  const { rowCount: outageRows } = await pool.query(
    "DELETE FROM outages WHERE ended_at IS NOT NULL AND ended_at < $1 AND note = ''",
    [historyCutoff],
  );

  // Una nota spiega la causa di un guasto: è la traccia da tenere, non un dato da smaltire
  await pool.query("DELETE FROM service_outages WHERE ended_at IS NOT NULL AND ended_at < $1 AND note = ''", [historyCutoff]);
  await pool.query("DELETE FROM maintenance_windows WHERE ends_at < $1", [historyCutoff]);
  await pool.query("DELETE FROM alerts WHERE ts < $1", [cutoff]);
  await pool.query("DELETE FROM server_metrics WHERE ts < $1", [cutoff]);
  await pool.query("DELETE FROM audit_log WHERE ts < $1", [new Date(now.getTime() - auditDays * DAY_MS)]);

  await pool.query(
    "INSERT INTO cleanup_log (ran_at, cutoff, ping_rows, outage_rows) VALUES ($1, $2, $3, $4)",
    [now, cutoff, pingRows, outageRows],
  );
  await saveLastCleanup(pool, now);

  return { ran: true, cutoff, pingRows, outageRows };
}

function saveLastCleanup(pool, at) {
  return pool.query(
    `INSERT INTO system_state (key, value, updated_at) VALUES ('last_cleanup', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ at: at.toISOString() })],
  );
}
