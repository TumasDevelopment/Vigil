// Scadenza dei domini: prima RDAP (il protocollo nuovo, in JSON), poi WHOIS sulla porta 43
// per i registri che RDAP non lo offrono ancora. Nessun servizio a pagamento.
import net from "node:net";

const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 64 * 1024;
const MAX_BOOTSTRAP_BYTES = 1024 * 1024;

/** Il nome di dominio pulito (minuscolo, IDN in punycode), oppure null se non è valido. */
export function normalizeDomain(input) {
  let value = String(input ?? "").trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
  let host;
  try {
    host = new URL(`http://${value}`).hostname;
  } catch {
    return null;
  }
  if (host.length < 3 || host.length > 253 || /^[\d.]+$/.test(host) || host.includes(":")) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  const tld = labels[labels.length - 1];
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return null;
  return host;
}

/** L'indirizzo del server RDAP per il dominio, dal file di bootstrap della IANA. */
export function rdapServerFor(bootstrap, name) {
  const labels = name.split(".");
  let best = null;
  for (const [suffixes, urls] of bootstrap?.services ?? []) {
    for (const suffix of suffixes) {
      const parts = String(suffix).toLowerCase().split(".");
      const matches = parts.length < labels.length && labels.slice(-parts.length).join(".") === parts.join(".");
      if (matches && (!best || parts.length > best.length)) {
        const url = urls.find((candidate) => candidate.startsWith("https://")) ?? urls[0];
        if (url) best = { length: parts.length, url: url.endsWith("/") ? url : `${url}/` };
      }
    }
  }
  return best?.url ?? null;
}

function vcardName(entity) {
  const fields = Array.isArray(entity?.vcardArray?.[1]) ? entity.vcardArray[1] : [];
  const fn = fields.find((field) => Array.isArray(field) && field[0] === "fn");
  return typeof fn?.[3] === "string" && fn[3].trim() ? fn[3].trim().slice(0, 120) : null;
}

export function parseRdap(json) {
  const events = Array.isArray(json?.events) ? json.events : [];
  const expiration = events.find((event) => event?.eventAction === "expiration")?.eventDate;
  const date = expiration ? new Date(expiration) : null;
  const registrar = (Array.isArray(json?.entities) ? json.entities : []).find(
    (entity) => Array.isArray(entity?.roles) && entity.roles.includes("registrar"),
  );
  return {
    expiresAt: date && !Number.isNaN(date.getTime()) ? date : null,
    registrar: registrar ? vcardName(registrar) : null,
  };
}

/** Il server WHOIS del registro, dalla risposta di whois.iana.org. */
export function whoisReferral(text) {
  const match = /^\s*(?:refer|whois):\s*([a-z0-9.-]+)\s*$/im.exec(String(text));
  return match ? match[1].toLowerCase() : null;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Le date come le scrivono i vari registri: ISO, 2027.03.15, 15-Mar-2027, 15.03.2027, 2027/03/15. */
export function parseLooseDate(text) {
  const value = String(text).trim();
  let match = /^(\d{4})[-./](\d{2})[-./](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|UTC|[+-]\d{2}:?\d{2})?/i.exec(value);
  if (match) {
    const [, year, month, day, hour = "0", minute = "0", second = "0", zone] = match;
    let time = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    if (zone && /^[+-]/.test(zone)) {
      const sign = zone[0] === "-" ? -1 : 1;
      const digits = zone.replace(/[^\d]/g, "");
      time -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000;
    }
    return new Date(time);
  }
  match = /^(\d{1,2})[- ]([a-z]{3})[a-z]*[- ](\d{4})/i.exec(value);
  if (match && MONTHS[match[2].toLowerCase()] !== undefined) {
    return new Date(Date.UTC(Number(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1])));
  }
  match = /^(\d{2})[./-](\d{2})[./-](\d{4})/.exec(value);
  if (match) return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  return null;
}

const EXPIRY_LABELS = [
  "registry expiry date",
  "registrar registration expiration date",
  "expiration date",
  "expiry date",
  "expire date",
  "expiration time",
  "expires on",
  "expires",
  "paid-till",
  "valid until",
  "renewal date",
];

export function parseWhoisExpiry(text) {
  const lines = String(text).split(/\r?\n/);
  for (const label of EXPIRY_LABELS) {
    for (const line of lines) {
      const match = /^\s*([^:]+?)\s*:\s*(.+)$/.exec(line);
      if (!match || match[1].toLowerCase() !== label) continue;
      const date = parseLooseDate(match[2]);
      if (date && !Number.isNaN(date.getTime())) return date;
    }
  }
  return null;
}

export function parseWhoisRegistrar(text) {
  const match = /^\s*(?:registrar|sponsoring registrar|registrar name)\s*:\s*(\S.*)$/im.exec(String(text));
  return match ? match[1].trim().slice(0, 120) : null;
}

/** Giorni interi alla scadenza (negativi se è già passata). */
export const daysUntil = (date, now = new Date()) => Math.floor((date.getTime() - now.getTime()) / 86_400_000);

// --- Rete ---

async function readLimited(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("risposta troppo grande");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function getJson(url, limit) {
  const response = await fetch(url, {
    headers: { accept: "application/rdap+json, application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  if (response.status === 404) return { notFound: true };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { json: JSON.parse(await readLimited(response, limit)) };
}

let bootstrapCache = { at: 0, data: null };

async function bootstrap() {
  if (bootstrapCache.data && Date.now() - bootstrapCache.at < BOOTSTRAP_TTL_MS) return bootstrapCache.data;
  const { json } = await getJson(BOOTSTRAP_URL, MAX_BOOTSTRAP_BYTES);
  bootstrapCache = { at: Date.now(), data: json };
  return json;
}

export function whoisQuery(server, query) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const socket = net.connect({ host: server, port: 43 });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("WHOIS: tempo scaduto")));
    socket.on("connect", () => socket.write(`${query}\r\n`));
    socket.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) socket.destroy(new Error("WHOIS: risposta troppo grande"));
      else chunks.push(chunk);
    });
    socket.on("error", reject);
    socket.on("close", (hadError) => {
      if (!hadError) resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

async function lookupWhois(name) {
  const tld = name.split(".").pop();
  const server = whoisReferral(await whoisQuery("whois.iana.org", tld));
  if (!server) throw new Error("nessun server WHOIS per questo dominio");
  let text = await whoisQuery(server, name);
  let expiresAt = parseWhoisExpiry(text);
  // I registri "thin" (.com, .net) rimandano al WHOIS del registrar
  const registrarServer = /^\s*registrar whois server:\s*([a-z0-9.-]+)\s*$/im.exec(text)?.[1];
  if (!expiresAt && registrarServer && registrarServer.toLowerCase() !== server) {
    text = await whoisQuery(registrarServer.toLowerCase(), name);
    expiresAt = parseWhoisExpiry(text);
  }
  if (!expiresAt) throw new Error("scadenza non trovata nella risposta WHOIS");
  return { expiresAt, registrar: parseWhoisRegistrar(text), source: "whois" };
}

/** { expiresAt, registrar, source } oppure un errore con un messaggio leggibile. */
export async function checkDomain(name) {
  let rdapError = null;
  try {
    const server = rdapServerFor(await bootstrap(), name);
    if (server) {
      const result = await getJson(`${server}domain/${encodeURIComponent(name)}`, MAX_BYTES);
      if (result.notFound) throw new Error("dominio non registrato");
      const parsed = parseRdap(result.json);
      if (parsed.expiresAt) return { ...parsed, source: "rdap" };
    }
  } catch (error) {
    if (error.message === "dominio non registrato") throw error;
    rdapError = error;
  }
  try {
    return await lookupWhois(name);
  } catch (error) {
    throw new Error(rdapError ? `${error.message} (RDAP: ${rdapError.message})` : error.message);
  }
}
