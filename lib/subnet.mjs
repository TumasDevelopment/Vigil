// Conti sugli indirizzi IPv4 per la ricerca dei dispositivi. Li usano il sito e il worker.

/** La rete proposta al massimo: 1.022 indirizzi, una ricerca di meno di un minuto. Si può scriverne una più ampia. */
export const SUGGESTED_PREFIX = 22;

/** Quanti indirizzi si provano insieme: di più sulle reti grandi, che altrimenti durerebbero ore. */
export const scanConcurrency = (count) => (count > 1024 ? 48 : 24);

/** Un indirizzo che non risponde occupa una corsia per circa un secondo: il ping aspetta tanto. */
const SECONDS_PER_ADDRESS = 1.05;

/**
 * Stima in secondi del tempo per provare `count` indirizzi. Le corsie dipendono dalla rete
 * intera (`networkSize`), anche quando si stima solo ciò che resta di una ricerca in corso.
 */
export const scanSeconds = (count, networkSize = count) =>
  Math.ceil(count / scanConcurrency(networkSize)) * SECONDS_PER_ADDRESS;

const OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const PRIVATE_BLOCKS = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
];
const LOOPBACK_BLOCK = ["127.0.0.0", 8];
export const VIRTUAL_INTERFACE = /^(lo|docker|br-|veth|virbr|tun|tap|wg)/;

const IP = String.raw`\d{1,3}(?:\.\d{1,3}){3}`;
// 192.168.1.0/24, 192.168.1.0/255.255.255.0 oppure 192.168.1.0 255.255.255.0
const SUBNET = new RegExp(String.raw`^(${IP})\s*(?:/\s*(\d{1,2}|${IP})|\s+(${IP}))$`);
const FORMAT_ERROR = "Scrivi la sottorete così: 192.168.1.0/24 oppure 192.168.1.0/255.255.255.0.";

export function ipToNumber(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4 || !parts.every((part) => OCTET.test(part))) return null;
  return parts.reduce((total, part) => total * 256 + Number(part), 0);
}

export const numberToIp = (value) => [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join(".");

const blockStart = (value, prefix) => {
  const size = 2 ** (32 - prefix);
  return Math.floor(value / size) * size;
};

/** 255.255.255.0 → 24. Null se la maschera non è valida, cioè con bit a 1 non tutti a sinistra. */
export function maskToPrefix(mask) {
  const value = ipToNumber(mask);
  if (value === null) return null;
  for (let prefix = 0; prefix <= 32; prefix++) {
    if (value === 2 ** 32 - 2 ** (32 - prefix)) return prefix;
  }
  return null;
}

function readPrefix(text) {
  if (text.includes(".")) return maskToPrefix(text);
  const prefix = Number(text);
  return prefix <= 32 ? prefix : null;
}

/**
 * Legge una sottorete di qualsiasi ampiezza, con il prefisso (/24) o con la maschera (255.255.255.0).
 * Solo reti private: una ricerca verso Internet non ha senso qui e farebbe scattare gli allarmi
 * di chi la riceve. Per questo la più ampia è una /8 (10.0.0.0/8). `allowLoopback` serve solo
 * alle prove, che non devono toccare la rete vera.
 */
export function parseSubnet(input, { allowLoopback = false } = {}) {
  const match = SUBNET.exec(String(input).trim());
  const value = match ? ipToNumber(match[1]) : null;
  if (value === null) return { error: FORMAT_ERROR };
  const maskText = match[2] ?? match[3];
  const prefix = readPrefix(maskText);
  if (prefix === null) {
    return maskText.includes(".")
      ? { error: `La maschera ${maskText} non è valida: per esempio 255.255.255.0, cioè /24.` }
      : { error: FORMAT_ERROR };
  }

  const first = blockStart(value, prefix);
  const blocks = (allowLoopback ? [...PRIVATE_BLOCKS, LOOPBACK_BLOCK] : PRIVATE_BLOCKS).map(([base, bits]) => [
    ipToNumber(base),
    bits,
  ]);
  const inside = blocks.some(([base, bits]) => prefix >= bits && blockStart(first, bits) === base);
  if (!inside) {
    const covers = blocks.some(([base, bits]) => blockStart(base, Math.min(prefix, bits)) === first);
    return {
      error: covers
        ? "Rete troppo ampia: esce dagli indirizzi privati. Le più ampie sono 10.0.0.0/8, 172.16.0.0/12 e 192.168.0.0/16."
        : "Si possono cercare solo reti private: 10.x.x.x, 172.16-31.x.x, 192.168.x.x.",
    };
  }
  return { cidr: `${numberToIp(first)}/${prefix}`, first, size: 2 ** (32 - prefix) };
}

/**
 * Gli indirizzi da provare, senza costruirli tutti: una /8 ne ha 16 milioni.
 * Indirizzo di rete e broadcast esclusi, tranne dove non esistono (/31 e /32).
 */
export function addressList({ first, size }) {
  const skip = size > 2 ? 1 : 0;
  const start = first + skip;
  const length = size - 2 * skip;
  return { length, at: (index) => (index >= 0 && index < length ? numberToIp(start + index) : undefined) };
}

/** Gli stessi indirizzi in un array: solo per le reti piccole e per le prove. */
export function subnetAddresses(subnet) {
  const list = addressList(subnet);
  return Array.from({ length: list.length }, (_, index) => list.at(index));
}

/** La sottorete da proporre: quella della scheda di rete del server, non quelle virtuali. */
export function defaultSubnet(interfaces) {
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal || !address.cidr) continue;
      const [ip, bits] = address.cidr.split("/");
      const parsed = parseSubnet(`${ip}/${Math.max(Number(bits), SUGGESTED_PREFIX)}`);
      if (parsed.cidr) return parsed.cidr;
    }
  }
  return "";
}
