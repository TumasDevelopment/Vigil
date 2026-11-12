export function durationText(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} g ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${total % 60} s`;
  return `${total} s`;
}

const hostPlace = (host) => [host.address, host.group_name].filter(Boolean).join(" · ");

const dependentsText = (count) =>
  count === 1 ? "1 dispositivo collegato non raggiungibile" : `${count} dispositivi collegati non raggiungibili`;

export function hostDownAlert(host, dependents = 0) {
  const place = hostPlace(host);
  return {
    hostId: host.id,
    level: "problem",
    title: `${host.name} è offline`,
    body: dependents > 0 ? [place, dependentsText(dependents)].filter(Boolean).join(" · ") : place,
  };
}

/** L'avviso era rimandato: la manutenzione è finita, o il dispositivo a monte è tornato, e l'host è ancora giù. */
export function hostStillDownAlert(host, seconds) {
  return {
    hostId: host.id,
    level: "problem",
    title: `${host.name} è offline`,
    body: [`Offline da ${durationText(seconds)}`, hostPlace(host)].filter(Boolean).join(" · "),
  };
}

export function hostUpAlert(host, seconds) {
  return {
    hostId: host.id,
    level: "resolved",
    title: `${host.name} è di nuovo online`,
    body: `Offline per ${durationText(seconds)} · ${hostPlace(host)}`,
  };
}

/** Testo dell'avviso per un evento di nextCheckState, oppure null se non serve avvisare. */
export function serviceAlert(check, event, detail) {
  const label = `${check.name} su ${check.host_name}`;
  if (event === "failed") return { hostId: check.host_id, level: "problem", title: `${label} non risponde`, body: detail };
  if (event === "recovered") return { hostId: check.host_id, level: "resolved", title: `${label} è tornato attivo`, body: detail };
  if (event === "warned") return { hostId: check.host_id, level: "warning", title: `${label}: attenzione`, body: detail };
  return null;
}

/** Il guasto non è stato preso in carico: l'avviso sale al livello successivo. */
export function escalationAlert({ hostId, checkId = null, name, tier, seconds }) {
  return {
    hostId,
    checkId,
    tier,
    level: "problem",
    title: checkId ? `${name} ancora non risponde` : `${name} è ancora offline`,
    body: `Nessuno l'ha preso in carico da ${durationText(seconds)} · livello ${tier}`,
  };
}

/** Alla fine delle ore di silenzio: ciò che è caduto di notte e non è ancora tornato. */
export function afterQuietAlert({ hostId, checkId = null, name, tier, seconds, place }) {
  return {
    hostId,
    checkId,
    tier,
    level: "problem",
    title: checkId ? `${name} non risponde` : `${name} è offline`,
    body: [`Durante le ore di silenzio, giù da ${durationText(seconds)}`, place].filter(Boolean).join(" · "),
  };
}

/**
 * Il JOIN scarta gli avvisi di un host eliminato mentre il ciclo era in corso.
 * Con `quiet` (ore di silenzio) gli avvisi degli host non critici restano nell'elenco ma non vanno ai PC;
 * quelli del server (host_id null) non sono mai silenziati. Un "è tornato" resta silenzioso solo se
 * anche il guasto lo era (`since` = inizio del guasto): chi ha ricevuto il problema riceve la soluzione.
 */
export async function insertAlerts(client, alerts, { quiet = false } = {}) {
  if (alerts.length === 0) return;
  await client.query(
    `INSERT INTO alerts (host_id, level, title, body, caused_by, tier, check_id, quiet)
     SELECT u.host_id, u.level, u.title, u.body, c.id, u.tier, s.id,
            $8::boolean AND u.host_id IS NOT NULL AND NOT coalesce(h.critical, false)
            AND (u.level <> 'resolved' OR (u.since IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM alerts p
                  WHERE p.host_id = u.host_id AND p.check_id IS NOT DISTINCT FROM u.check_id
                    AND p.level = 'problem' AND NOT p.quiet AND p.ts >= u.since)))
     FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::int[], $6::smallint[], $7::int[],
                 $9::timestamptz[])
          WITH ORDINALITY AS u(host_id, level, title, body, caused_by, tier, check_id, since, position)
     LEFT JOIN hosts h ON h.id = u.host_id
     LEFT JOIN hosts c ON c.id = u.caused_by
     LEFT JOIN service_checks s ON s.id = u.check_id
     WHERE u.host_id IS NULL OR h.id IS NOT NULL
     ORDER BY u.position`,
    [
      alerts.map((alert) => alert.hostId ?? null),
      alerts.map((alert) => alert.level),
      alerts.map((alert) => alert.title),
      alerts.map((alert) => alert.body),
      alerts.map((alert) => alert.causedBy ?? null),
      alerts.map((alert) => Math.min(3, Math.max(1, alert.tier ?? 1))),
      alerts.map((alert) => alert.checkId ?? null),
      quiet,
      alerts.map((alert) => alert.since ?? null),
    ],
  );
}
