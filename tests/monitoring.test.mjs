import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { durationText, hostDownAlert, hostStillDownAlert, hostUpAlert, serviceAlert } from "../worker/alerts.mjs";
import { findCause, HOST_SETTLE_MS, hostHealth } from "../worker/dependencies.mjs";
import {
  certResult,
  isDue,
  isHttpOk,
  nextCheckState,
  reachabilityFromChecks,
  runCheck,
} from "../worker/checks.mjs";
import {
  cpuPercent,
  metricRow,
  parseMeminfo,
  parseNginx,
  parsePm2,
  serverObservations,
  trackProblems,
} from "../worker/server-health.mjs";
import { healthProblems } from "../lib/health.ts";
import { isValidCheckUrl } from "../lib/validate.ts";

const at = (seconds) => new Date(seconds * 1000);
const fresh = { status: "unknown", since: null, failStreak: 0, failSince: null };
const pass = { ok: true, ms: 3, detail: "" };
const fail = { ok: false, ms: null, detail: "Connessione rifiutata" };

test("isHttpOk: una pagina protetta da password conta come attiva", () => {
  for (const code of [200, 204, 301, 302, 401, 403]) assert.equal(isHttpOk(code), true, String(code));
  for (const code of [400, 404, 500, 502, 503]) assert.equal(isHttpOk(code), false, String(code));
});

test("certResult distingue valido, in scadenza, oggi e scaduto", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  assert.deepEqual(
    { ok: certResult("Dec  1 12:00:00 2026 GMT", now, 30).ok, warn: certResult("Dec  1 12:00:00 2026 GMT", now, 30).warn },
    { ok: true, warn: false },
  );

  const soon = certResult("Jun 20 12:00:00 2026 GMT", now, 30);
  assert.equal(soon.ok, true);
  assert.equal(soon.warn, true);
  assert.match(soon.detail, /tra 19 giorni/);

  assert.match(certResult("Jun  2 13:00:00 2026 GMT", now, 30).detail, /tra 1 giorno$/);

  const today = certResult("Jun  1 18:00:00 2026 GMT", now, 30);
  assert.equal(today.warn, true);
  assert.match(today.detail, /^Scade oggi/);

  const expired = certResult("May 31 12:00:00 2026 GMT", now, 30);
  assert.equal(expired.ok, false);
  assert.match(expired.detail, /scaduto/);

  assert.equal(certResult("non è una data", now, 30).ok, false);
});

test("certResult: la soglia dei giorni è compresa", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  assert.equal(certResult("Jul  1 12:00:00 2026 GMT", now, 30).warn, true);
  assert.equal(certResult("Jul  2 12:00:00 2026 GMT", now, 30).warn, false);
});

test("isDue: i certificati si leggono di rado, ma se falliscono si riprova subito", () => {
  const now = at(10_000);
  assert.equal(isDue({ kind: "tcp", last_check: null, fail_streak: 0 }, now, 30_000, 3_600_000), true);
  assert.equal(isDue({ kind: "tcp", last_check: at(9_980), fail_streak: 0 }, now, 30_000, 3_600_000), false);
  assert.equal(isDue({ kind: "tcp", last_check: at(9_970), fail_streak: 0 }, now, 30_000, 3_600_000), true);
  assert.equal(isDue({ kind: "cert", last_check: at(9_900), fail_streak: 0 }, now, 30_000, 3_600_000), false);
  assert.equal(isDue({ kind: "cert", last_check: at(9_900), fail_streak: 1 }, now, 30_000, 3_600_000), true);
});

test("isDue: il margine evita di saltare un giro quando il ciclo arriva appena prima", () => {
  assert.equal(isDue({ kind: "tcp", last_check: at(9_970.5), fail_streak: 0 }, at(10_000), 30_000, 3_600_000), true);
});

test("nextCheckState: un errore solo non basta, due sì, e l'interruzione parte dal primo", () => {
  const first = nextCheckState({ ...fresh, status: "ok", since: at(1) }, fail, at(100), 2);
  assert.equal(first.status, "ok");
  assert.equal(first.event, null);
  assert.equal(first.openOutageAt, null);

  const second = nextCheckState({ ...fresh, status: "ok", since: at(1), failStreak: 1, failSince: at(100) }, fail, at(130), 2);
  assert.equal(second.status, "failed");
  assert.equal(second.event, "failed");
  assert.deepEqual(second.openOutageAt, at(100));
  assert.deepEqual(second.since, at(100));
});

test("nextCheckState: un servizio già fermo non riapre un'interruzione", () => {
  const next = nextCheckState({ status: "failed", since: at(1), failStreak: 5, failSince: at(1) }, fail, at(200), 2);
  assert.equal(next.status, "failed");
  assert.equal(next.event, null);
  assert.equal(next.openOutageAt, null);
});

test("nextCheckState: il ritorno chiude l'interruzione", () => {
  const next = nextCheckState({ status: "failed", since: at(1), failStreak: 5, failSince: at(1) }, pass, at(200), 2);
  assert.equal(next.status, "ok");
  assert.equal(next.event, "recovered");
  assert.deepEqual(next.closeOutageAt, at(200));
  assert.equal(next.failStreak, 0);
  assert.equal(next.failSince, null);
});

test("nextCheckState: un successo azzera gli errori isolati senza eventi", () => {
  const next = nextCheckState({ status: "ok", since: at(1), failStreak: 1, failSince: at(100) }, pass, at(130), 2);
  assert.equal(next.event, null);
  assert.equal(next.failStreak, 0);
  assert.deepEqual(next.since, at(1));
});

test("nextCheckState: attenzione e rientro per un certificato", () => {
  const warned = nextCheckState({ ...fresh, status: "ok", since: at(1) }, { ...pass, warn: true }, at(100), 2);
  assert.equal(warned.status, "warn");
  assert.equal(warned.event, "warned");

  const same = nextCheckState({ ...fresh, status: "warn", since: at(100) }, { ...pass, warn: true }, at(200), 2);
  assert.equal(same.event, null);
  assert.deepEqual(same.since, at(100));

  const cleared = nextCheckState({ ...fresh, status: "warn", since: at(100) }, pass, at(300), 2);
  assert.equal(cleared.event, "cleared");
});

test("nextCheckState: un servizio che parte già guasto viene segnalato", () => {
  const first = nextCheckState(fresh, fail, at(10), 2);
  assert.equal(first.status, "unknown");
  const second = nextCheckState({ ...fresh, failStreak: 1, failSince: at(10) }, fail, at(40), 2);
  assert.equal(second.event, "failed");
});

test("reachabilityFromChecks: basta un controllo che risponde, i certificati non contano", () => {
  assert.equal(reachabilityFromChecks([]), null);
  assert.equal(reachabilityFromChecks([{ kind: "tcp", status: "unknown", last_ms: null }]), null);
  assert.equal(reachabilityFromChecks([{ kind: "cert", status: "ok", last_ms: 9 }]), null);

  const mixed = reachabilityFromChecks([
    { kind: "tcp", status: "failed", last_ms: null },
    { kind: "http", status: "ok", last_ms: 12 },
    { kind: "tcp", status: "warn", last_ms: 4 },
  ]);
  assert.deepEqual(mixed, { sent: 1, received: 1, rttMin: 4, rttAvg: 4, rttMax: 4 });

  const down = reachabilityFromChecks([{ kind: "tcp", status: "failed", last_ms: null }]);
  assert.equal(down.received, 0);
  assert.equal(down.rttAvg, null);
});

test("reachabilityFromChecks: un errore isolato non fa cadere l'host", () => {
  // Dopo un solo errore il controllo resta "ok" e ha solo perso il tempo di risposta
  const blip = reachabilityFromChecks([{ kind: "tcp", status: "ok", last_ms: null }]);
  assert.equal(blip.received, 1);
  assert.equal(blip.rttAvg, null);
});

test("runCheck tcp: porta aperta e porta chiusa", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const open = await runCheck({ kind: "tcp", address: "127.0.0.1", port });
  assert.equal(open.ok, true);
  assert.equal(typeof open.ms, "number");

  await new Promise((resolve) => server.close(resolve));
  const closed = await runCheck({ kind: "tcp", address: "127.0.0.1", port });
  assert.equal(closed.ok, false);
  assert.equal(closed.detail, "Connessione rifiutata");
});

const inputs = {
  failStreak: 0,
  lastLoss: 0,
  rtt1m: 5,
  loss1m: 0,
  latencyWarn: null,
  lossWarn: null,
  failedServices: [],
};

test("healthProblems: senza soglie resta il comportamento di prima", () => {
  assert.deepEqual(healthProblems(inputs), []);
  assert.deepEqual(healthProblems({ ...inputs, lastLoss: 33.3 }), ["Perdita 33,3 %"]);
  assert.deepEqual(healthProblems({ ...inputs, failStreak: 1 }), ["Ultimo controllo fallito"]);
  assert.deepEqual(healthProblems({ ...inputs, rtt1m: 900 }), []);
});

test("healthProblems: con la soglia di perdita un pacchetto perso non basta", () => {
  assert.deepEqual(healthProblems({ ...inputs, lossWarn: 10, lastLoss: 33.3, loss1m: 5 }), []);
  assert.deepEqual(healthProblems({ ...inputs, lossWarn: 10, loss1m: 10 }), []);
  assert.deepEqual(healthProblems({ ...inputs, lossWarn: 10, loss1m: 12.5 }), ["Perdita 12,5 %, soglia 10 %"]);
});

test("healthProblems: la soglia di latenza si supera in senso stretto", () => {
  assert.deepEqual(healthProblems({ ...inputs, latencyWarn: 50, rtt1m: 50 }), []);
  assert.deepEqual(healthProblems({ ...inputs, latencyWarn: 50, rtt1m: 50.5 }), ["Latenza 50,5 ms, soglia 50 ms"]);
  assert.deepEqual(healthProblems({ ...inputs, latencyWarn: 50, rtt1m: null }), []);
});

test("healthProblems: un servizio fermo si nomina, più servizi si contano", () => {
  assert.deepEqual(healthProblems({ ...inputs, failedServices: ["Gestionale"] }), ["Gestionale non risponde"]);
  assert.deepEqual(healthProblems({ ...inputs, failedServices: ["A", "B"] }), ["2 servizi non rispondono"]);
});

test("isValidCheckUrl: solo http e https, senza credenziali", () => {
  assert.equal(isValidCheckUrl("https://192.168.1.1/"), true);
  assert.equal(isValidCheckUrl("http://intranet.local:8080/stato"), true);
  assert.equal(isValidCheckUrl("ftp://192.168.1.1/"), false);
  assert.equal(isValidCheckUrl("javascript:alert(1)"), false);
  assert.equal(isValidCheckUrl("https://utente:segreto@192.168.1.1/"), false);
  assert.equal(isValidCheckUrl("192.168.1.1"), false);
  assert.equal(isValidCheckUrl(`https://a.it/${"x".repeat(300)}`), false);
});

test("durationText usa l'unità adatta", () => {
  assert.equal(durationText(45), "45 s");
  assert.equal(durationText(125), "2 min 5 s");
  assert.equal(durationText(3720), "1 h 2 min");
  assert.equal(durationText(90_000), "1 g 1 h");
  assert.equal(durationText(-4), "0 s");
});

test("i testi degli avvisi dicono cosa è successo e dove", () => {
  const host = { id: 7, name: "NAS", address: "192.168.1.9", group_name: "Sala server" };
  assert.deepEqual(hostDownAlert(host), {
    hostId: 7,
    level: "problem",
    title: "NAS è offline",
    body: "192.168.1.9 · Sala server",
  });
  assert.equal(hostUpAlert(host, 125).body, "Offline per 2 min 5 s · 192.168.1.9 · Sala server");
  assert.equal(hostDownAlert({ ...host, group_name: "" }).body, "192.168.1.9");
  assert.equal(hostDownAlert(host, 1).body, "192.168.1.9 · Sala server · 1 dispositivo collegato non raggiungibile");
  assert.equal(hostDownAlert(host, 19).body, "192.168.1.9 · Sala server · 19 dispositivi collegati non raggiungibili");
  assert.equal(hostStillDownAlert(host, 125).title, "NAS è offline");
  assert.equal(hostStillDownAlert(host, 125).body, "Offline da 2 min 5 s · 192.168.1.9 · Sala server");

  const check = { host_id: 7, host_name: "NAS", name: "Web" };
  assert.equal(serviceAlert(check, "failed", "Rifiutata").title, "Web su NAS non risponde");
  assert.equal(serviceAlert(check, "recovered", "").level, "resolved");
  assert.equal(serviceAlert(check, "warned", "Scade").level, "warning");
  assert.equal(serviceAlert(check, "cleared", ""), null);
  assert.equal(serviceAlert(check, null, ""), null);
});

test("parseMeminfo legge i valori in byte", () => {
  const memory = parseMeminfo("MemTotal: 1000 kB\nMemFree: 1 kB\nMemAvailable: 400 kB\nSwapTotal: 200 kB\nSwapFree: 50 kB\n");
  assert.deepEqual(memory, { memTotal: 1_024_000, memAvailable: 409_600, swapTotal: 204_800, swapFree: 51_200 });
});

test("cpuPercent confronta due letture", () => {
  assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 300 }), 50);
  assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 100, total: 200 }), null);
});

test("parsePm2 non si porta dietro le variabili d'ambiente", () => {
  const out = `[PM2] rumore prima del JSON\n${JSON.stringify([
    {
      name: "sito",
      monit: { cpu: 2, memory: 1000 },
      pm2_env: { status: "online", restart_time: 3, pm_uptime: 5000, DATABASE_URL: "postgres://segreto" },
    },
  ])}`;
  const [process] = parsePm2(out);
  assert.deepEqual(process, { name: "sito", status: "online", restarts: 3, startedAt: 5, cpu: 2, memory: 1000 });
  assert.equal(JSON.stringify(process).includes("segreto"), false);
  assert.equal(parsePm2("niente"), null);
});

test("parseNginx trova le porte con proxy e ignora redirect e commenti", () => {
  const sites = parseNginx(`
    server {
      listen 80;
      server_name esempio.it;
      return 301 https://$host$request_uri;
    }
    # server { listen 9999 ssl; proxy_pass http://127.0.0.1:1; }
    server {
      listen 8442 ssl http2;
      server_name sito.example.com;
      location / {
        proxy_pass http://127.0.0.1:3102;
        proxy_set_header Host $host;
      }
    }
    server {
      listen 127.0.0.1:8080;
      location / { proxy_pass http://localhost:3200/; }
    }`);
  assert.deepEqual(sites, [
    { port: 8442, tls: true, upstream: 3102, serverName: "sito.example.com" },
    { port: 8080, tls: false, upstream: 3200, serverName: "localhost" },
  ]);
});

const health = (overrides = {}) => ({
  diskUsed: 50,
  diskTotal: 100,
  memUsed: 1,
  memTotal: 2,
  swapUsed: 0,
  swapTotal: 0,
  load: [0.5, 0, 0],
  cpu: 10,
  processes: [{ name: "sito", status: "online" }],
  ports: [{ port: 8442, ok: true, detail: "Risposta HTTP 200" }],
  ...overrides,
});

test("metricRow calcola le percentuali e regge lo swap assente", () => {
  assert.deepEqual(metricRow(health()), { cpu: 10, mem: 50, swap: null, disk: 50, load: 0.5 });
});

test("trackProblems: ciò che è già rotto al primo sguardo non avvisa", () => {
  const broken = health({ ports: [{ port: 8442, ok: false, detail: "502" }] });
  const first = trackProblems(null, serverObservations(broken));
  assert.deepEqual(first.alerts, []);
  const second = trackProblems(first.state, serverObservations(broken));
  assert.deepEqual(second.alerts, []);
});

test("trackProblems: un guasto nuovo serve due campioni, poi avvisa una volta sola", () => {
  const start = trackProblems(null, serverObservations(health())).state;
  const broken = serverObservations(health({ ports: [{ port: 8442, ok: false, detail: "502" }] }));

  const one = trackProblems(start, broken);
  assert.deepEqual(one.alerts, []);

  const two = trackProblems(one.state, broken);
  assert.equal(two.alerts.length, 1);
  assert.equal(two.alerts[0].title, "La porta 8442 non funziona");

  const three = trackProblems(two.state, broken);
  assert.deepEqual(three.alerts, []);

  const back = trackProblems(three.state, serverObservations(health()));
  assert.equal(back.alerts.length, 1);
  assert.equal(back.alerts[0].level, "resolved");
});

test("trackProblems: un riavvio di un minuto non avvisa", () => {
  const start = trackProblems(null, serverObservations(health())).state;
  const restarting = serverObservations(health({ processes: [{ name: "sito", status: "stopping" }] }));
  const one = trackProblems(start, restarting);
  const back = trackProblems(one.state, serverObservations(health()));
  assert.deepEqual([...one.alerts, ...back.alerts], []);
});

test("trackProblems: se PM2 non risponde lo stato dei processi resta", () => {
  const stopped = serverObservations(health({ processes: [{ name: "sito", status: "stopped" }] }));
  const known = trackProblems(null, stopped).state;
  const blind = trackProblems(known, serverObservations(health({ processes: null })));
  assert.deepEqual(blind.alerts, []);
  assert.deepEqual(blind.state["pm2:sito"], known["pm2:sito"]);
});

test("trackProblems: un guasto già presente che si risolve lo si dice", () => {
  const broken = serverObservations(health({ ports: [{ port: 8442, ok: false, detail: "502" }] }));
  const known = trackProblems(null, broken).state;
  const back = trackProblems(known, serverObservations(health()));
  assert.equal(back.alerts[0].title, "La porta 8442 è tornata a rispondere");
});

test("serverObservations: il disco oltre il limite conta come problema", () => {
  const disk = (used) => serverObservations(health({ diskUsed: used })).find((item) => item.key === "disk").bad;
  assert.equal(disk(89), false);
  assert.equal(disk(90), true);
});

const NOW = new Date("2026-11-05T12:00:00Z");

test("hostHealth: cosa dice un host su chi gli sta dietro", () => {
  const long = new Date(NOW.getTime() - HOST_SETTLE_MS);
  const recent = new Date(NOW.getTime() - HOST_SETTLE_MS + 1000);
  assert.equal(hostHealth(undefined, NOW), "unknown");
  assert.equal(hostHealth({ status: null }, NOW), "unknown");
  assert.equal(hostHealth({ status: "unknown", failStreak: 0 }, NOW), "unknown");
  assert.equal(hostHealth({ status: "offline", since: long, failStreak: 0 }, NOW), "down");
  assert.equal(hostHealth({ status: "online", since: long, failStreak: 1 }, NOW), "down");
  assert.equal(hostHealth({ status: "online", since: recent, failStreak: 0 }, NOW), "down");
  assert.equal(hostHealth({ status: "online", since: long, failStreak: 0 }, NOW), "healthy");
});

const chain = (...links) => new Map(links.map(([id, parentId, health]) => [id, { parentId, health }]));

test("findCause: senza collegamento il guasto è suo", () => {
  assert.equal(findCause(1, chain([1, null, "down"])), null);
  assert.equal(findCause(9, new Map()), null);
});

test("findCause: il dispositivo a monte giù spiega il guasto", () => {
  assert.equal(findCause(2, chain([1, null, "down"], [2, 1, "down"])), 1);
  assert.equal(findCause(2, chain([1, null, "healthy"], [2, 1, "down"])), null);
});

test("findCause: con più livelli conta il più alto ancora giù", () => {
  assert.equal(findCause(3, chain([1, null, "down"], [2, 1, "down"], [3, 2, "down"])), 1);
  assert.equal(findCause(3, chain([1, null, "healthy"], [2, 1, "down"], [3, 2, "down"])), 2);
});

test("findCause: un anello sano ferma la risalita", () => {
  assert.equal(findCause(3, chain([1, null, "down"], [2, 1, "healthy"], [3, 2, "down"])), null);
});

test("findCause: un anello senza dati non dice nulla, si guarda più su", () => {
  assert.equal(findCause(3, chain([1, null, "down"], [2, 1, "unknown"], [3, 2, "down"])), 1);
  assert.equal(findCause(3, chain([1, null, "healthy"], [2, 1, "unknown"], [3, 2, "down"])), null);
});

test("findCause: un cerchio nei dati non blocca il worker", () => {
  assert.equal(findCause(1, chain([1, 2, "down"], [2, 1, "down"])), 2);
  assert.equal(findCause(1, chain([1, 1, "down"])), null);
  assert.equal(findCause(1, chain([1, 2, "down"], [2, 3, "unknown"], [3, 2, "unknown"])), null);
});

test("findCause: un collegamento verso un host eliminato si ignora", () => {
  assert.equal(findCause(2, chain([2, 77, "down"])), null);
});
