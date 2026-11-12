// Le impostazioni salvate nella tabella settings. Le legge sia l'app sia il worker:
// qui ci sono i valori predefiniti e la pulizia di ciò che arriva dal database.

export const ALERT_DEFAULTS = Object.freeze({
  quietEnabled: false,
  quietFrom: "22:00",
  quietTo: "07:00",
  timeZone: "Europe/Rome",
  // Minuti senza presa in carico prima di passare al livello successivo; 0 = mai
  escalationMinutes: 15,
  // Giorni di anticipo per l'avviso di garanzia in scadenza
  warrantyDays: 30,
});

export const STATUS_DEFAULTS = Object.freeze({
  enabled: false,
  title: "Stato dei servizi",
  note: "",
});

export const isClock = (value) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function isTimeZone(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const intBetween = (value, min, max, fallback) =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;

const textUpTo = (value, max, fallback) => (typeof value === "string" ? value.trim().slice(0, max) : fallback);

/** Ciò che manca o non è valido torna al valore predefinito. */
export function normalizeAlertSettings(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    quietEnabled: value.quietEnabled === true,
    quietFrom: isClock(value.quietFrom) ? value.quietFrom : ALERT_DEFAULTS.quietFrom,
    quietTo: isClock(value.quietTo) ? value.quietTo : ALERT_DEFAULTS.quietTo,
    timeZone: isTimeZone(value.timeZone) ? value.timeZone : ALERT_DEFAULTS.timeZone,
    escalationMinutes: intBetween(value.escalationMinutes, 0, 1440, ALERT_DEFAULTS.escalationMinutes),
    warrantyDays: intBetween(value.warrantyDays, 1, 365, ALERT_DEFAULTS.warrantyDays),
  };
}

export function normalizeStatusSettings(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: value.enabled === true,
    title: textUpTo(value.title, 80, "") || STATUS_DEFAULTS.title,
    note: textUpTo(value.note, 500, STATUS_DEFAULTS.note),
  };
}

const clockMinutes = (clock) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** I minuti trascorsi dalla mezzanotte nel fuso indicato. */
export function minutesOfDay(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return pick("hour") * 60 + pick("minute");
}

/** Vero se `date` cade nelle ore di silenzio. Dalle 22:00 alle 07:00 passa la mezzanotte. */
export function isQuietTime(date, settings) {
  if (!settings.quietEnabled) return false;
  const from = clockMinutes(settings.quietFrom);
  const to = clockMinutes(settings.quietTo);
  if (from === to) return false;
  const now = minutesOfDay(date, settings.timeZone);
  return from < to ? now >= from && now < to : now >= from || now < to;
}
