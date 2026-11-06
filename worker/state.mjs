/**
 * Calcola il nuovo stato di un host dopo un ciclo di ping.
 * Un host diventa offline solo dopo `threshold` cicli falliti di fila, così un
 * singolo ciclo perso non genera una falsa interruzione. L'interruzione parte
 * dal primo ciclo fallito, non dal momento in cui è stata confermata.
 *
 * @param {{status:string,since:Date,failStreak:number,failSince:Date|null}|null} prev
 * @param {{sent:number,received:number}} result
 * @param {Date} ts
 * @param {number} threshold
 */
export function nextState(prev, result, ts, threshold) {
  const current = prev ?? { status: "unknown", since: ts, failStreak: 0, failSince: null };

  if (result.received > 0) {
    const changed = current.status !== "online";
    return {
      status: "online",
      since: changed ? ts : current.since,
      failStreak: 0,
      failSince: null,
      openOutageAt: null,
      closeOutageAt: current.status === "offline" ? ts : null,
    };
  }

  const failStreak = current.failStreak + 1;
  const failSince = current.failSince ?? ts;
  const goesOffline = current.status !== "offline" && failStreak >= threshold;

  return {
    status: goesOffline ? "offline" : current.status,
    since: goesOffline ? failSince : current.since,
    failStreak,
    failSince,
    openOutageAt: goesOffline ? failSince : null,
    closeOutageAt: null,
  };
}
