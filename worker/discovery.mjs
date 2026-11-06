import { execFile } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { parsePing } from "./ping.mjs";

/** Le porte che dicono qualcosa sul dispositivo: accesso remoto, web, condivisioni, stampa, video. */
export const SCAN_PORTS = [22, 80, 443, 445, 554, 631, 3389, 9100];

const OUI_FILE = "/usr/share/ieee-data/oui.txt";
const PROBE_MS = 800;
const DNS_MS = 1000;
const PROGRESS_MS = 2000;
const SCAN_CONCURRENCY = 24;
const NAME_MAX = 80;

const NETWORK_VENDORS = /cisco|ubiquiti|mikrotik|aruba|juniper|netgear|tp-link|fortinet|zyxel|d-link/;
const PRINTER_VENDORS = /brother|canon|epson|kyocera|lexmark|ricoh|xerox|konica/;
const CAMERA_VENDORS = /hikvision|dahua|axis comm|hanwha|vivotek/;
const STORAGE_VENDORS = /synology|qnap/;
const PLC_VENDORS = /siemens|schneider|rockwell|beckhoff|omron|phoenix contact|wago|mitsubishi/;

/** Una stima, che l'amministratore corregge prima di aggiungere: meglio "altro" di un tipo sbagliato. */
export function guessType(ports, vendor) {
  const brand = (vendor ?? "").toLowerCase();
  const open = new Set(ports);
  if (open.has(9100) || open.has(631) || PRINTER_VENDORS.test(brand)) return "stampante";
  if (open.has(554) || CAMERA_VENDORS.test(brand)) return "telecamera";
  if (STORAGE_VENDORS.test(brand)) return "storage";
  if (PLC_VENDORS.test(brand)) return "macchina";
  if (NETWORK_VENDORS.test(brand)) return "switch";
  if (open.has(3389)) return "pc";
  if (open.has(445) || open.has(22)) return "server";
  return "altro";
}

/** Il nome breve da un nome DNS. Arriva dalla rete: si tiene solo ciò che è davvero un nome. */
export function shortName(dnsName) {
  const label = String(dnsName ?? "").split(".")[0];
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(label) ? label.slice(0, NAME_MAX) : null;
}

/** Legge `ip -4 neigh show`. Le righe senza MAC, come FAILED e INCOMPLETE, non servono. */
export function parseNeighbours(stdout) {
  const neighbours = new Map();
  for (const line of stdout.split("\n")) {
    const match = /^(\d+\.\d+\.\d+\.\d+) dev \S+ lladdr ([0-9a-f:]{17}).*\s([A-Z]+)$/.exec(line.trim());
    if (match) neighbours.set(match[1], { mac: match[2], state: match[3] });
  }
  return neighbours;
}

/**
 * Dopo un tentativo di contatto una voce REACHABLE o STALE è una risposta recente.
 * Le altre aspettano ancora una conferma: non bastano a dire che il dispositivo c'è.
 */
export const neighbourAnswered = (entry) => entry?.state === "REACHABLE" || entry?.state === "STALE";

const prefixOf = (mac) => mac.slice(0, 8).replaceAll(":", "-").toUpperCase();

/** Dal file IEEE tiene solo i produttori dei MAC trovati: l'elenco intero pesa 5 MB. */
export function parseVendors(text, macs) {
  const wanted = new Set(macs.map(prefixOf));
  const vendors = new Map();
  for (const line of text.split("\n")) {
    const match = /^([0-9A-F]{2}-[0-9A-F]{2}-[0-9A-F]{2})\s+\(hex\)\s+(.+?)\s*$/.exec(line);
    if (match && wanted.has(match[1])) vendors.set(match[1], match[2]);
  }
  return vendors;
}

export const vendorOf = (vendors, mac) => (mac ? (vendors.get(prefixOf(mac)) ?? null) : null);

/** Un solo pacchetto: la scansione deve essere veloce, e un'assenza qui non è un guasto. */
function pingOnce(address) {
  return new Promise((resolve) => {
    execFile(
      "ping",
      ["-n", "-q", "-c", "1", "-W", "1", "--", address],
      { timeout: 2500, killSignal: "SIGKILL", env: { ...process.env, LC_ALL: "C" } },
      (_error, stdout) => {
        const result = parsePing(stdout ?? "");
        resolve(result?.received ? result.rttAvg : null);
      },
    );
  });
}

function probePort(address, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: address, port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(PROBE_MS, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function probeAddress(address) {
  const [rtt, ...open] = await Promise.all([pingOnce(address), ...SCAN_PORTS.map((port) => probePort(address, port))]);
  return { address, rtt, ports: SCAN_PORTS.filter((_port, index) => open[index]) };
}

async function reverseName(resolver, address) {
  try {
    const [name] = await resolver.reverse(address);
    return shortName(name);
  } catch {
    return null;
  }
}

function readNeighbours() {
  return new Promise((resolve) => {
    execFile("ip", ["-4", "neigh", "show"], { timeout: 3000 }, (_error, stdout) =>
      resolve(parseNeighbours(stdout ?? "")),
    );
  });
}

async function readVendors(macs) {
  if (macs.length === 0) return new Map();
  try {
    return parseVendors(await readFile(OUI_FILE, "utf8"), macs);
  } catch {
    return new Map(); // Senza l'elenco si perde solo il nome del produttore
  }
}

/**
 * Prova gli indirizzi e restituisce quelli che hanno risposto. `onProgress` riceve quanti
 * ne ha provati e restituisce false per fermare la ricerca: in quel caso il risultato è null.
 */
export async function scanAddresses(addresses, onProgress) {
  const probed = [];
  let next = 0;
  let cancelled = false;
  let reported = Date.now();

  async function lane() {
    while (next < addresses.length && !cancelled) {
      probed.push(await probeAddress(addresses[next++]));
      if (Date.now() - reported < PROGRESS_MS) continue;
      reported = Date.now();
      if ((await onProgress(probed.length)) === false) cancelled = true;
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, addresses.length) }, lane));
  if (cancelled) return null;

  const neighbours = await readNeighbours();
  const alive = probed.filter(
    (item) => item.rtt !== null || item.ports.length > 0 || neighbourAnswered(neighbours.get(item.address)),
  );
  const vendors = await readVendors(alive.flatMap((item) => neighbours.get(item.address)?.mac ?? []));

  const resolver = new Resolver({ timeout: DNS_MS, tries: 1 });
  const names = await Promise.all(alive.map((item) => reverseName(resolver, item.address)));

  return alive
    .map((item, index) => {
      const mac = neighbours.get(item.address)?.mac ?? null;
      const vendor = vendorOf(vendors, mac);
      return { ...item, name: names[index], mac, vendor, type: guessType(item.ports, vendor) };
    })
    .sort((a, b) => a.address.localeCompare(b.address, "en", { numeric: true }));
}
