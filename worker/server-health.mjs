import { execFile } from "node:child_process";
import { readdir, readFile, statfs } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import { join } from "node:path";

const NGINX_FOLDERS = ["/etc/nginx/sites-enabled", "/etc/nginx/conf.d"];
const PORT_TIMEOUT_MS = 5000;
export const DISK_ALERT_PCT = 90;

export function parseMeminfo(text) {
  const read = (key) => Number(new RegExp(`^${key}:\\s+(\\d+) kB`, "m").exec(text)?.[1] ?? 0) * 1024;
  return {
    memTotal: read("MemTotal"),
    memAvailable: read("MemAvailable"),
    swapTotal: read("SwapTotal"),
    swapFree: read("SwapFree"),
  };
}

export function cpuTimes(cpus = os.cpus()) {
  let idle = 0;
  let total = 0;
  for (const { times } of cpus) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

export function cpuPercent(before, after) {
  const total = after.total - before.total;
  if (total <= 0) return null;
  return Math.min(100, Math.max(0, 100 * (1 - (after.idle - before.idle) / total)));
}

/** Tiene solo i campi che servono: `pm2 jlist` contiene anche le variabili d'ambiente dei processi. */
export function parsePm2(stdout) {
  // PM2 può stampare prima righe come "[PM2] Spawning...": il JSON è quello che inizia con [{ o []
  const start = stdout.search(/^\[[{\]]/m);
  if (start < 0) return null;
  return JSON.parse(stdout.slice(start)).map((item) => ({
    name: String(item.name),
    status: String(item.pm2_env?.status ?? "sconosciuto"),
    restarts: Number(item.pm2_env?.restart_time ?? 0),
    startedAt: item.pm2_env?.pm_uptime ? Number(item.pm2_env.pm_uptime) / 1000 : null,
    cpu: Number(item.monit?.cpu ?? 0),
    memory: Number(item.monit?.memory ?? 0),
  }));
}

function serverBlocks(text) {
  const clean = text.replace(/#.*$/gm, "");
  const blocks = [];
  for (const match of clean.matchAll(/\bserver\s*\{/g)) {
    let depth = 1;
    let index = match.index + match[0].length;
    while (index < clean.length && depth > 0) {
      if (clean[index] === "{") depth++;
      else if (clean[index] === "}") depth--;
      index++;
    }
    blocks.push(clean.slice(match.index, index));
  }
  return blocks;
}

/** Le porte pubblicate da nginx che rimandano a un sito interno. I soli redirect non contano. */
export function parseNginx(text) {
  const sites = [];
  for (const block of serverBlocks(text)) {
    const upstream = /proxy_pass\s+https?:\/\/[^:/\s]+:(\d+)/.exec(block)?.[1];
    if (!upstream) continue;
    const serverName = /server_name\s+([^\s;]+)/.exec(block)?.[1] ?? "localhost";
    for (const listen of block.matchAll(/^\s*listen\s+(?:[\d.]+:)?(\d+)([^;]*);/gm)) {
      sites.push({
        port: Number(listen[1]),
        tls: /\bssl\b/.test(listen[2]),
        upstream: Number(upstream),
        serverName,
      });
    }
  }
  return sites;
}

async function readNginxSites() {
  const sites = new Map();
  let readable = false;
  for (const folder of NGINX_FOLDERS) {
    const names = await readdir(folder).catch(() => []);
    for (const name of names) {
      const text = await readFile(join(folder, name), "utf8").catch(() => null);
      if (text === null) continue;
      readable = true;
      for (const site of parseNginx(text)) sites.set(site.port, site);
    }
  }
  return { readable, sites: [...sites.values()].sort((a, b) => a.port - b.port) };
}

function probeSite(site) {
  return new Promise((resolve) => {
    const client = site.tls ? https : http;
    const finish = (code, detail) => {
      clearTimeout(timer);
      request.destroy();
      resolve({ port: site.port, upstream: site.upstream, code, ok: code !== null && code < 500, detail });
    };
    const request = client.request(
      {
        host: "127.0.0.1",
        port: site.port,
        path: "/",
        method: "GET",
        agent: false,
        servername: site.tls ? site.serverName : undefined,
        rejectUnauthorized: false,
        headers: { host: site.serverName, "user-agent": "vigil" },
      },
      (response) => {
        const code = response.statusCode;
        finish(code, code === 502 ? `Nessun processo sulla porta ${site.upstream}` : `Risposta HTTP ${code}`);
      },
    );
    const timer = setTimeout(() => finish(null, "Nessuna risposta"), PORT_TIMEOUT_MS);
    request.once("error", (error) => finish(null, error.code ?? error.message));
    request.end();
  });
}

function readPm2() {
  return new Promise((resolve) => {
    execFile("pm2", ["jlist"], { timeout: 15_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      try {
        resolve(parsePm2(stdout));
      } catch {
        resolve(null);
      }
    });
  });
}

// Al primo campione non c'è un intervallo da misurare: varrebbe solo l'avvio del worker, sempre vicino al 100 %
let lastCpu = null;

export async function collectServerHealth() {
  const now = cpuTimes();
  const cpu = lastCpu ? cpuPercent(lastCpu, now) : null;
  lastCpu = now;

  const [meminfo, disk, processes, nginx] = await Promise.all([
    readFile("/proc/meminfo", "utf8"),
    statfs("/"),
    readPm2(),
    readNginxSites(),
  ]);
  const memory = parseMeminfo(meminfo);
  const ports = await Promise.all(nginx.sites.map(probeSite));

  const blockSize = Number(disk.bsize);
  const diskUsed = (Number(disk.blocks) - Number(disk.bfree)) * blockSize;
  const diskTotal = diskUsed + Number(disk.bavail) * blockSize;

  return {
    cpu,
    cores: os.cpus().length,
    load: os.loadavg(),
    uptime: os.uptime(),
    memUsed: memory.memTotal - memory.memAvailable,
    memTotal: memory.memTotal,
    swapUsed: memory.swapTotal - memory.swapFree,
    swapTotal: memory.swapTotal,
    diskUsed,
    diskTotal,
    processes,
    nginxReadable: nginx.readable,
    ports,
  };
}

const percent = (used, total) => (total > 0 ? (100 * used) / total : null);

export const metricRow = (health) => ({
  cpu: health.cpu,
  mem: percent(health.memUsed, health.memTotal),
  swap: percent(health.swapUsed, health.swapTotal),
  disk: percent(health.diskUsed, health.diskTotal),
  load: health.load[0],
});

/** Le condizioni da tenere d'occhio, ognuna con la sua chiave stabile. */
export function serverObservations(health) {
  const items = [
    {
      key: "disk",
      bad: percent(health.diskUsed, health.diskTotal) >= DISK_ALERT_PCT,
      problem: {
        level: "warning",
        title: "Disco del server quasi pieno",
        body: `Oltre il ${DISK_ALERT_PCT} % di spazio occupato`,
      },
      resolved: { level: "resolved", title: "Spazio su disco di nuovo disponibile", body: "" },
    },
  ];
  for (const process of health.processes ?? []) {
    items.push({
      key: `pm2:${process.name}`,
      bad: process.status !== "online",
      problem: { level: "problem", title: `Processo ${process.name} fermo`, body: `Stato PM2: ${process.status}` },
      resolved: { level: "resolved", title: `Processo ${process.name} di nuovo attivo`, body: "" },
    });
  }
  for (const port of health.ports) {
    items.push({
      key: `port:${port.port}`,
      bad: !port.ok,
      problem: { level: "problem", title: `La porta ${port.port} non funziona`, body: port.detail },
      resolved: { level: "resolved", title: `La porta ${port.port} è tornata a rispondere`, body: port.detail },
    });
  }
  return items;
}

/**
 * Avvisa solo sui cambiamenti confermati da `confirm` campioni di fila, così un riavvio
 * non fa scattare nulla. Ciò che è già guasto al primo sguardo non genera un avviso.
 */
export function trackProblems(previous, observations, confirm = 2) {
  // Se PM2 non risponde mancano le sue voci: restano com'erano, non ripartono da zero
  const state = { ...previous };
  const alerts = [];
  for (const item of observations) {
    const before = previous?.[item.key];
    if (!before) {
      state[item.key] = { streak: item.bad ? confirm : 0, alerted: item.bad };
      continue;
    }
    const streak = item.bad ? before.streak + 1 : 0;
    let alerted = before.alerted;
    if (item.bad && !alerted && streak >= confirm) {
      alerted = true;
      alerts.push(item.problem);
    } else if (!item.bad && alerted) {
      alerted = false;
      alerts.push(item.resolved);
    }
    state[item.key] = { streak, alerted };
  }
  return { state, alerts };
}
