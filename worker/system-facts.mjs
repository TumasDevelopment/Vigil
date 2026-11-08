// I dati del server che cambiano di rado: sistema operativo, hardware, rete, versioni dei programmi.
// Il worker li legge all'avvio e ogni tanto; la pagina Sistema li mostra senza aggiornarli dal vivo.
import { execFile } from "node:child_process";
import { readFile, stat, statfs } from "node:fs/promises";
import os from "node:os";
import { VIRTUAL_INTERFACE } from "../lib/subnet.mjs";
import { OUI_FILE } from "./discovery.mjs";
import { parseMeminfo } from "./server-health.mjs";

const COMMAND_MS = 3000;
const TEXT_MAX = 120;
// I valori segnaposto dei produttori, che non dicono nulla
const PLACEHOLDER = /^(to be filled|default string|system product name|not specified|none|o\.e\.m\.)/i;

const clean = (value) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);
  return text && !PLACEHOLDER.test(text) ? text : null;
};

/** Legge /etc/os-release: righe CHIAVE=valore, con il valore a volte tra virgolette. */
export function parseOsRelease(text) {
  const fields = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) fields[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return {
    name: clean(fields.PRETTY_NAME ?? fields.NAME),
    version: clean(fields.VERSION ?? fields.VERSION_ID),
    codename: clean(fields.VERSION_CODENAME),
  };
}

/** Il gateway predefinito da /proc/net/route, dove gli indirizzi sono esadecimali con i byte al contrario. */
export function parseDefaultGateway(text) {
  for (const line of text.split("\n").slice(1)) {
    const [iface, destination, gateway, flags] = line.trim().split(/\s+/);
    // Flag 0x2 = RTF_GATEWAY: la riga passa davvero da un gateway
    if (destination !== "00000000" || !/^[0-9A-F]{8}$/i.test(gateway ?? "") || !(parseInt(flags, 16) & 2)) continue;
    const bytes = gateway.match(/../g).map((byte) => parseInt(byte, 16));
    return { address: bytes.reverse().join("."), iface };
  }
  return null;
}

/** I server DNS di un resolv.conf. */
export function parseNameservers(text) {
  const servers = [];
  for (const line of text.split("\n")) {
    const match = /^\s*nameserver\s+([0-9a-fA-F.:]+)/.exec(line);
    if (match && !servers.includes(match[1])) servers.push(match[1]);
  }
  return servers;
}

/** Le schede di rete vere, senza loopback e senza quelle virtuali di Docker, VPN e simili. */
export function networkCards(interfaces) {
  const cards = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    const real = (addresses ?? []).filter((address) => !address.internal);
    if (real.length === 0) continue;
    const mac = real.find((address) => address.mac && address.mac !== "00:00:00:00:00:00")?.mac ?? null;
    // Prima IPv4, poi IPv6; gli indirizzi link-local IPv6 (fe80::) non servono a chi amministra
    const cidrs = real
      .filter((address) => address.family === "IPv4" || !address.address.startsWith("fe80:"))
      .sort((a, b) => (a.family === b.family ? 0 : a.family === "IPv4" ? -1 : 1))
      .map((address) => address.cidr ?? address.address);
    cards.push({ name, mac, addresses: cidrs });
  }
  return cards.sort((a, b) => a.name.localeCompare(b.name));
}

/** La prima riga che un comando scrive, su stdout o stderr (nginx -v scrive su stderr). Null se manca. */
function firstLine(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: COMMAND_MS, killSignal: "SIGKILL", env: { ...process.env, LC_ALL: "C" } }, (error, stdout, stderr) => {
      if (error && error.code === "ENOENT") return resolve(null);
      resolve(clean(`${stdout ?? ""}\n${stderr ?? ""}`.trim().split("\n")[0]));
    });
  });
}

const readText = (path) => readFile(path, "utf8").catch(() => null);

const packageVersion = async (url) => {
  const text = await readText(url);
  try {
    return text ? clean(JSON.parse(text).version) : null;
  } catch {
    return null;
  }
};

async function nameservers() {
  // Con systemd-resolved /etc/resolv.conf indica solo 127.0.0.53: i server veri sono in questo file
  const resolved = await readText("/run/systemd/resolve/resolv.conf");
  const servers = resolved ? parseNameservers(resolved) : [];
  return servers.length > 0 ? servers : parseNameservers((await readText("/etc/resolv.conf")) ?? "");
}

async function virtualization() {
  const kind = await firstLine("systemd-detect-virt", []);
  return kind === "none" ? "Nessuna (macchina fisica)" : kind;
}

export async function collectSystemFacts() {
  const [osRelease, vendor, product, virt, meminfo, disk, route, dns, ping, nginx, oui, vigil, next] =
    await Promise.all([
      readText("/etc/os-release").then((text) => text ?? readText("/usr/lib/os-release")),
      readText("/sys/class/dmi/id/sys_vendor"),
      readText("/sys/class/dmi/id/product_name"),
      virtualization(),
      readText("/proc/meminfo"),
      statfs("/").catch(() => null),
      readText("/proc/net/route"),
      nameservers(),
      firstLine("ping", ["-V"]),
      firstLine("nginx", ["-v"]),
      stat(OUI_FILE).catch(() => null),
      packageVersion(new URL("../package.json", import.meta.url)),
      packageVersion(new URL("../node_modules/next/package.json", import.meta.url)),
    ]);

  const cpus = os.cpus();
  const memory = parseMeminfo(meminfo ?? "");
  return {
    os: { ...parseOsRelease(osRelease ?? ""), kernel: os.release(), arch: os.machine(), platform: os.platform() },
    hostname: os.hostname(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    bootedAt: Math.floor(Date.now() / 1000 - os.uptime()),
    hardware: { vendor: clean(vendor), product: clean(product), virtualization: virt },
    cpu: { model: clean(cpus[0]?.model), cores: cpus.length },
    memTotal: memory.memTotal || os.totalmem(),
    swapTotal: memory.swapTotal,
    diskTotal: disk ? disk.blocks * disk.bsize : null,
    network: {
      gateway: route ? parseDefaultGateway(route) : null,
      dns,
      cards: networkCards(os.networkInterfaces()),
    },
    software: {
      vigil,
      next,
      node: process.version,
      ping: ping?.replace(/^ping from /, "") ?? null,
      nginx: nginx?.replace(/^nginx version: /, "") ?? null,
    },
    ouiUpdatedAt: oui ? Math.round(oui.mtimeMs / 1000) : null,
    workerStartedAt: Math.floor(Date.now() / 1000 - process.uptime()),
  };
}
