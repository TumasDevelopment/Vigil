const DAY_MS = 86_400_000;
const BATCH_ROWS = 50_000;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ogni `cycleDays` giorni cancella i dati più vecchi di `keepDays`.
 * Con 14 e 7: ogni due settimane sparisce la prima, resta la seconda.
 * La data dell'ultima pulizia sta nel database, quindi i riavvii non azzerano il conteggio.
 * Le interruzioni ancora in corso non vengono mai cancellate.
 */
export async function runRetentionIfDue(pool, { cycleDays, keepDays, now = new Date() }) {
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
    [cutoff],
  );

  // Una nota spiega la causa di un guasto: è la traccia da tenere, non un dato da smaltire
  await pool.query("DELETE FROM service_outages WHERE ended_at IS NOT NULL AND ended_at < $1 AND note = ''", [cutoff]);
  await pool.query("DELETE FROM maintenance_windows WHERE ends_at < $1", [cutoff]);
  await pool.query("DELETE FROM alerts WHERE ts < $1", [cutoff]);
  await pool.query("DELETE FROM server_metrics WHERE ts < $1", [cutoff]);

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
