// Conti sugli indirizzi IPv4 per la ricerca dei dispositivi. Li usano il sito e il worker.

/** La rete più ampia ammessa: 1.022 indirizzi, una scansione di meno di un minuto. */
export const WIDEST_PREFIX = 22;

const OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const PRIVATE_BLOCKS = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
];
const LOOPBACK_BLOCK = ["127.0.0.0", 8];
const VIRTUAL_INTERFACE = /^(lo|docker|br-|veth|virbr|tun|tap|wg)/;

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

const inBlock = (value, [base, prefix]) => blockStart(value, prefix) === ipToNumber(base);

/**
 * Legge una sottorete scritta come 192.168.1.0/24. Solo reti private: una scansione verso
 * Internet non ha senso qui e farebbe scattare gli allarmi di chi la riceve.
 * `allowLoopback` serve solo alle prove, che non devono toccare la rete vera.
 */
export function parseSubnet(input, { allowLoopback = false } = {}) {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(String(input).trim());
  const value = match ? ipToNumber(match[1]) : null;
  const prefix = match ? Number(match[2]) : null;
  if (value === null || prefix === null || prefix > 32) return { error: "Scrivi la sottorete così: 192.168.1.0/24." };
  if (prefix < WIDEST_PREFIX) {
    return { error: `Rete troppo ampia: al massimo una /${WIDEST_PREFIX}, cioè 1.022 indirizzi.` };
  }

  const first = blockStart(value, prefix);
  const blocks = allowLoopback ? [...PRIVATE_BLOCKS, LOOPBACK_BLOCK] : PRIVATE_BLOCKS;
  if (!blocks.some((block) => inBlock(first, block))) {
    return { error: "Si possono cercare solo reti private: 10.x.x.x, 172.16-31.x.x, 192.168.x.x." };
  }
  return { cidr: `${numberToIp(first)}/${prefix}`, first, size: 2 ** (32 - prefix) };
}

/** Gli indirizzi da provare: indirizzo di rete e broadcast esclusi, tranne dove non esistono. */
export function subnetAddresses({ first, size }) {
  const skip = size > 2 ? 1 : 0;
  return Array.from({ length: size - 2 * skip }, (_, index) => numberToIp(first + skip + index));
}

/** La sottorete da proporre: quella della scheda di rete del server, non quelle virtuali. */
export function defaultSubnet(interfaces) {
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal || !address.cidr) continue;
      const [ip, bits] = address.cidr.split("/");
      const parsed = parseSubnet(`${ip}/${Math.max(Number(bits), WIDEST_PREFIX)}`);
      if (parsed.cidr) return parsed.cidr;
    }
  }
  return "";
}
