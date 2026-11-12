import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

export const CHECK_TIMEOUT_MS = 5000;
const DAY_MS = 86_400_000;

const ERROR_TEXT = {
  ECONNREFUSED: "Connessione rifiutata",
  ECONNRESET: "Connessione interrotta",
  EHOSTUNREACH: "Host non raggiungibile",
  ENETUNREACH: "Rete non raggiungibile",
  ENOTFOUND: "Nome non trovato",
  EAI_AGAIN: "Nome non trovato",
  ETIMEDOUT: "Nessuna risposta",
};

export const errorText = (error) => ERROR_TEXT[error.code] ?? error.code ?? error.message ?? "Errore sconosciuto";

/** 401 e 403 contano come riusciti: la pagina c'è, è solo protetta da una password. */
export const isHttpOk = (code) => (code >= 200 && code < 400) || code === 401 || code === 403;

const dateFormat = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });

export function certResult(validTo, now, warnDays) {
  const expires = new Date(validTo);
  if (Number.isNaN(expires.getTime())) return { ok: false, detail: "Certificato non leggibile" };

  const days = Math.floor((expires.getTime() - now.getTime()) / DAY_MS);
  const date = dateFormat.format(expires);
  if (expires.getTime() <= now.getTime()) return { ok: false, detail: `Certificato scaduto il ${date}` };
  if (days === 0) return { ok: true, warn: true, detail: `Scade oggi, ${date}` };
  const left = days === 1 ? "tra 1 giorno" : `tra ${days} giorni`;
  return { ok: true, warn: days <= warnDays, detail: `Scade il ${date}, ${left}` };
}

/** La promessa si risolve sempre: un controllo fallito è un risultato, non un errore. */
function withTimeout(start) {
  return new Promise((resolve) => {
    let done = false;
    let cleanup = () => {};
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, ms: null, detail: `Nessuna risposta entro ${CHECK_TIMEOUT_MS / 1000} s` }),
      CHECK_TIMEOUT_MS,
    );
    cleanup = start(finish) ?? cleanup;
  });
}

function checkTcp(address, port) {
  return withTimeout((finish) => {
    const started = performance.now();
    const socket = net.connect({ host: address, port });
    socket.once("connect", () => finish({ ok: true, ms: performance.now() - started, detail: `Porta ${port} aperta` }));
    socket.once("error", (error) => finish({ ok: false, ms: null, detail: errorText(error) }));
    return () => socket.destroy();
  });
}

function checkHttp(url) {
  return withTimeout((finish) => {
    const started = performance.now();
    const client = url.startsWith("https:") ? https : http;
    // I certificati dei dispositivi interni sono spesso autofirmati: qui conta che il sito
    // risponda. La validità del certificato ha il suo controllo.
    const request = client.request(
      url,
      { method: "GET", agent: false, rejectUnauthorized: false, headers: { "user-agent": "vigil" } },
      (response) => {
        const code = response.statusCode;
        finish({ ok: isHttpOk(code), ms: performance.now() - started, detail: `Risposta HTTP ${code}` });
      },
    );
    request.once("error", (error) => finish({ ok: false, ms: null, detail: errorText(error) }));
    request.end();
    return () => request.destroy();
  });
}

function checkCert(url, warnDays, now) {
  return withTimeout((finish) => {
    const target = new URL(url);
    const host = target.hostname.replace(/^\[|\]$/g, "");
    const started = performance.now();
    const socket = tls.connect({
      host,
      port: Number(target.port) || 443,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: false,
    });
    socket.once("secureConnect", () => {
      const validTo = socket.getPeerCertificate()?.valid_to;
      const ms = performance.now() - started;
      const expires = validTo ? new Date(validTo) : null;
      const expiresAt = expires && !Number.isNaN(expires.getTime()) ? expires : null;
      finish(
        validTo ? { ms, ...certResult(validTo, now, warnDays), expiresAt } : { ok: false, ms, detail: "Nessun certificato" },
      );
    });
    socket.once("error", (error) => finish({ ok: false, ms: null, detail: errorText(error) }));
    return () => socket.destroy();
  });
}

export function runCheck(check, now = new Date()) {
  if (check.kind === "tcp") return checkTcp(check.address, check.port);
  if (check.kind === "http") return checkHttp(check.url);
  return checkCert(check.url, check.warn_days, now);
}

/** Un certificato non cambia ogni minuto, ma se fallisce va riprovato subito per confermare. */
export function isDue(check, now, baseMs, certMs) {
  if (!check.last_check) return true;
  const wait = check.kind === "cert" && check.fail_streak === 0 ? certMs : baseMs;
  // Margine di 1 s: i cicli hanno lo stesso passo del controllo e non devono saltare un giro
  return now.getTime() - new Date(check.last_check).getTime() >= wait - 1000;
}

/**
 * Stato di un controllo dopo un tentativo. Come per il ping, diventa "failed" solo dopo
 * `threshold` errori di fila e l'interruzione parte dal primo errore.
 * `event` dice cosa è cambiato: failed, recovered, warned, cleared oppure null.
 */
export function nextCheckState(prev, result, ts, threshold) {
  if (result.ok) {
    const status = result.warn ? "warn" : "ok";
    let event = null;
    if (prev.status === "failed") event = "recovered";
    else if (status === "warn" && prev.status !== "warn") event = "warned";
    else if (status === "ok" && prev.status === "warn") event = "cleared";
    return {
      status,
      since: status === prev.status ? prev.since : ts,
      failStreak: 0,
      failSince: null,
      openOutageAt: null,
      closeOutageAt: prev.status === "failed" ? ts : null,
      event,
    };
  }

  const failStreak = prev.failStreak + 1;
  const failSince = prev.failSince ?? ts;
  const goesDown = prev.status !== "failed" && failStreak >= threshold;
  return {
    status: goesDown ? "failed" : prev.status,
    since: goesDown ? failSince : prev.since,
    failStreak,
    failSince,
    openOutageAt: goesDown ? failSince : null,
    closeOutageAt: null,
    event: goesDown ? "failed" : null,
  };
}

/**
 * Per un host senza ping lo stato viene dai suoi controlli: basta che uno risponda.
 * Conta lo stato confermato, così un errore isolato non fa cadere l'host: il ciclo del
 * ping è più veloce dei controlli e vedrebbe lo stesso errore più volte.
 * I certificati non contano, perché si leggono troppo di rado.
 * Restituisce null se non c'è ancora nessun controllo su cui basarsi.
 */
export function reachabilityFromChecks(checks) {
  const known = checks.filter((check) => check.kind !== "cert" && check.status !== "unknown");
  if (known.length === 0) return null;

  const up = known.filter((check) => check.status !== "failed");
  const times = up.map((check) => check.last_ms).filter((ms) => ms !== null);
  const rtt = times.length > 0 ? Math.min(...times) : null;
  return { sent: 1, received: up.length > 0 ? 1 : 0, rttMin: rtt, rttAvg: rtt, rttMax: rtt };
}
