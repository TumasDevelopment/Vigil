const LOCALE = "it-IT";

const number = (value: number, digits: number) =>
  value.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function fmtMs(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  // In rete locale i tempi sono sotto il millisecondo: "0,0 ms" non direbbe nulla
  if (value < 1) return `${number(value, 2)} ms`;
  if (value < 10) return `${number(value, 1)} ms`;
  return `${number(value, 0)} ms`;
}

export function fmtPct(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) return "—";
  return `${number(value, value === 100 || value === 0 ? 0 : digits)} %`;
}

export function fmtUptime(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  // Per difetto: 99,996 non deve apparire come 100, un host con perdite non è "perfetto"
  const shown = value < 100 ? Math.floor(value * 100) / 100 : value;
  return `${number(shown, shown === 100 ? 0 : 2)} %`;
}

/** Tacche di un asse: stessi decimali per tutte, così la scala si legge regolare. */
export function fmtTicks(values: number[], unit: string) {
  const whole = (value: number, factor: number) => Math.abs(value * factor - Math.round(value * factor)) < 1e-9;
  const decimals = values.every((value) => whole(value, 1)) ? 0 : values.every((value) => whole(value, 10)) ? 1 : 2;
  return values.map((value) => `${number(value, decimals)} ${unit}`);
}

export function fmtDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "—";
  const total = Math.max(0, Math.round(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} g ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${total % 60} s`;
  return `${total} s`;
}

const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const hourFormat = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });
const dayHourFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const fullDateFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const fmtTime = (seconds: number) => timeFormat.format(seconds * 1000);
export const fmtDateTime = (seconds: number) => dateTimeFormat.format(seconds * 1000);
export const fmtFullDate = (seconds: number | null | undefined) =>
  seconds === null || seconds === undefined ? "—" : fullDateFormat.format(seconds * 1000);

/** "fino alle 14:30" se è oggi, altrimenti con la data. */
export function fmtUntil(seconds: number, now: number) {
  const today = new Date(seconds * 1000).toDateString() === new Date(now * 1000).toDateString();
  return today ? `fino alle ${fmtTime(seconds)}` : `fino al ${fmtDateTime(seconds)}`;
}

export function fmtAxisTime(seconds: number, rangeSeconds: number) {
  return (rangeSeconds > 172_800 ? dayHourFormat : hourFormat).format(seconds * 1000);
}

export function fmtBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024 ** 2) return `${number(bytes / 1024, 0)} KB`;
  if (bytes < 1024 ** 3) return `${number(bytes / 1024 ** 2, 1)} MB`;
  return `${number(bytes / 1024 ** 3, 2)} GB`;
}

export const fmtCount = (value: number) => value.toLocaleString(LOCALE);
