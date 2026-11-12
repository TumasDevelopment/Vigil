// Il report mensile: disponibilità, interruzioni e servizi di un mese di calendario,
// nel fuso orario delle impostazioni. Lo usano il worker (ogni primo del mese) e l'app (al volo).
import { PAGE_HEIGHT, PAGE_WIDTH, PdfDocument, fitText, textWidth } from "./pdf.mjs";

export const isMonth = (value) => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** Il mese prima di quello in cui cade `date`, nel fuso indicato: "AAAA-MM". */
export function previousMonth(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year").value);
  const month = Number(parts.find((part) => part.type === "month").value);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

export function currentMonth(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find((part) => part.type === "year").value}-${parts.find((part) => part.type === "month").value}`;
}

const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

export function monthLabel(month) {
  const [year, number] = month.split("-").map(Number);
  return `${MONTHS[number - 1]} ${year}`;
}

const BOUNDS = `
  SELECT ($1::date::timestamp AT TIME ZONE $2) AS from_ts,
         least((($1::date + interval '1 month')::timestamp AT TIME ZONE $2), now()) AS to_ts`;

// Le interruzioni create durante una manutenzione (mai avvisate, senza causa a monte) non contano
const COUNTED = "NOT (o.alerted = false AND o.cause_host_id IS NULL)";

/** Legge dal database ciò che serve. `query(sql, params)` restituisce le righe. */
export async function collectReport(query, { month, timeZone, now = new Date() }) {
  const day = `${month}-01`;
  const [bounds] = await query(BOUNDS, [day, timeZone]);
  const hosts = await query(
    `WITH b AS (${BOUNDS})
     SELECT h.id, h.name, h.group_name,
            extract(epoch FROM b.to_ts - greatest(b.from_ts, h.created_at))::float8 AS period
     FROM hosts h, b
     WHERE h.enabled AND h.ping_enabled AND h.created_at < b.to_ts`,
    [day, timeZone],
  );
  const outages = await query(
    `WITH b AS (${BOUNDS})
     SELECT o.host_id, o.started_at, o.ended_at, o.ack_by, c.name AS cause_name,
            extract(epoch FROM least(coalesce(o.ended_at, now()), b.to_ts)
                             - greatest(o.started_at, b.from_ts, h.created_at))::float8 AS seconds,
            CASE WHEN o.ended_at >= b.from_ts AND o.ended_at < b.to_ts
                 THEN extract(epoch FROM o.ended_at - o.started_at)::float8 END AS repair_seconds
     FROM outages o
     JOIN hosts h ON h.id = o.host_id
     LEFT JOIN hosts c ON c.id = o.cause_host_id
     CROSS JOIN b
     WHERE h.enabled AND h.ping_enabled
       AND o.started_at < b.to_ts AND coalesce(o.ended_at, now()) > b.from_ts
       AND ${COUNTED}`,
    [day, timeZone],
  );
  const services = await query(
    `WITH b AS (${BOUNDS})
     SELECT c.id, c.name, c.kind, h.name AS host_name,
            extract(epoch FROM b.to_ts - b.from_ts)::float8 AS period,
            count(so.id)::int AS failures,
            coalesce(sum(extract(epoch FROM least(coalesce(so.ended_at, now()), b.to_ts)
                                          - greatest(so.started_at, b.from_ts))), 0)::float8 AS down
     FROM service_checks c
     JOIN hosts h ON h.id = c.host_id
     CROSS JOIN b
     LEFT JOIN service_outages so ON so.check_id = c.id
       AND so.started_at < b.to_ts AND coalesce(so.ended_at, now()) > b.from_ts
     WHERE h.enabled
     GROUP BY c.id, c.name, c.kind, h.name, b.from_ts, b.to_ts`,
    [day, timeZone],
  );
  return summarizeReport({
    month,
    timeZone,
    from: new Date(bounds.from_ts),
    to: new Date(bounds.to_ts),
    generatedAt: now,
    hosts,
    outages,
    services,
  });
}

const availability = (period, down) => (period > 0 ? Math.max(0, Math.min(100, (1 - down / period) * 100)) : null);

/** Calcolo puro, separato dalle query per poterlo provare nei test. */
export function summarizeReport({ month, timeZone, from, to, generatedAt, hosts, outages, services }) {
  const byHost = new Map(
    hosts.map((host) => [Number(host.id), { id: Number(host.id), name: host.name, sector: host.group_name || "", period: Math.max(0, Number(host.period)), down: 0, outages: 0 }]),
  );
  const repairs = [];
  const longest = [];
  for (const outage of outages) {
    const host = byHost.get(Number(outage.host_id));
    if (!host) continue;
    const seconds = Math.max(0, Number(outage.seconds));
    host.down += seconds;
    host.outages += 1;
    if (outage.repair_seconds !== null && outage.repair_seconds !== undefined) repairs.push(Number(outage.repair_seconds));
    longest.push({
      host: host.name,
      sector: host.sector,
      startedAt: new Date(outage.started_at).toISOString(),
      endedAt: outage.ended_at ? new Date(outage.ended_at).toISOString() : null,
      seconds,
      cause: outage.cause_name ?? null,
      ackBy: outage.ack_by ?? null,
    });
  }
  const list = [...byHost.values()].map((host) => ({ ...host, down: Math.min(host.down, host.period) }));
  const totalPeriod = list.reduce((sum, host) => sum + host.period, 0);
  const totalDown = list.reduce((sum, host) => sum + host.down, 0);
  const outageCount = list.reduce((sum, host) => sum + host.outages, 0);

  const sectors = new Map();
  for (const host of list) {
    const sector = sectors.get(host.sector) ?? { name: host.sector, hosts: 0, period: 0, down: 0, outages: 0 };
    sector.hosts += 1;
    sector.period += host.period;
    sector.down += host.down;
    sector.outages += host.outages;
    sectors.set(host.sector, sector);
  }

  const serviceList = services.map((check) => {
    const period = Number(check.period);
    const down = Math.min(Math.max(0, Number(check.down)), period);
    return { name: check.name, host: check.host_name, kind: check.kind, failures: Number(check.failures), downtimeSeconds: down, availability: availability(period, down), period };
  });
  const servicePeriod = serviceList.reduce((sum, check) => sum + check.period, 0);
  const serviceDown = serviceList.reduce((sum, check) => sum + check.downtimeSeconds, 0);

  const byName = (a, b) => a.name.localeCompare(b.name, "it");
  return {
    month,
    label: monthLabel(month),
    timeZone,
    from: from.toISOString(),
    to: to.toISOString(),
    generatedAt: generatedAt.toISOString(),
    kpi: {
      hosts: list.length,
      availability: availability(totalPeriod, totalDown),
      outages: outageCount,
      downtimeSeconds: totalDown,
      mttrSeconds: repairs.length > 0 ? repairs.reduce((sum, value) => sum + value, 0) / repairs.length : null,
      mtbfSeconds: outageCount > 0 ? (totalPeriod - totalDown) / outageCount : null,
      services: serviceList.length,
      serviceFailures: serviceList.reduce((sum, check) => sum + check.failures, 0),
      serviceAvailability: availability(servicePeriod, serviceDown),
    },
    sectors: [...sectors.values()]
      .map((sector) => ({ name: sector.name, hosts: sector.hosts, outages: sector.outages, downtimeSeconds: sector.down, availability: availability(sector.period, sector.down) }))
      .sort((a, b) => (a.availability ?? 100) - (b.availability ?? 100) || byName(a, b)),
    worstHosts: list
      .filter((host) => host.outages > 0)
      .map((host) => ({ name: host.name, sector: host.sector, outages: host.outages, downtimeSeconds: host.down, availability: availability(host.period, host.down) }))
      .sort((a, b) => a.availability - b.availability || b.outages - a.outages || byName(a, b))
      .slice(0, 10),
    services: serviceList
      .map(({ period, ...check }) => check)
      .sort((a, b) => (a.availability ?? 100) - (b.availability ?? 100) || b.failures - a.failures || byName(a, b))
      .slice(0, 20),
    longest: longest.sort((a, b) => b.seconds - a.seconds).slice(0, 15),
  };
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const total = Math.round(Number(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} g ${hours % 24} h` : `${days} g`;
}

export function formatPercent(value, digits = 2) {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(digits).replace(".", ",")} %`;
}

// --- Impaginazione del PDF ---

const COLORS = {
  ink: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  soft: "#f1f5f9",
  accent: "#4f46e5",
  ok: "#16a34a",
  warn: "#d97706",
  bad: "#dc2626",
};
const MARGIN = 42;
const CONTENT = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = PAGE_HEIGHT - 50;

const availabilityColor = (value) => (value === null ? COLORS.muted : value >= 99.9 ? COLORS.ok : value >= 99 ? COLORS.warn : COLORS.bad);

export function renderReport(summary) {
  const pdf = new PdfDocument({ title: `Vigil · Report di ${summary.label}`, author: "Vigil" });
  const when = new Intl.DateTimeFormat("it-IT", { timeZone: summary.timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const stamp = new Intl.DateTimeFormat("it-IT", { timeZone: summary.timeZone, dateStyle: "long", timeStyle: "short" });
  let y = 0;

  function newPage() {
    pdf.addPage();
    pdf.rect(0, 0, PAGE_WIDTH, 6, { fill: COLORS.accent });
    y = MARGIN;
  }

  function ensure(space) {
    if (y + space > BOTTOM) newPage();
  }

  function heading(title, note = "") {
    ensure(60);
    y += 14;
    pdf.text(MARGIN, y, title, { size: 13, bold: true, color: COLORS.ink });
    if (note) pdf.text(MARGIN, y, note, { size: 8.5, color: COLORS.muted, align: "right", width: CONTENT });
    y += 10;
  }

  function table(columns, rows, empty) {
    const rowHeight = 17;
    const header = () => {
      let x = MARGIN;
      pdf.rect(MARGIN, y, CONTENT, rowHeight, { fill: COLORS.soft });
      for (const column of columns) {
        pdf.text(x + 5, y + 11.5, column.label, { size: 8, bold: true, color: COLORS.muted, align: column.align ?? "left", width: column.width - 10 });
        x += column.width;
      }
      y += rowHeight;
    };
    if (rows.length === 0) {
      pdf.text(MARGIN, y + 12, empty, { size: 9, color: COLORS.muted });
      y += 22;
      return;
    }
    ensure(rowHeight * 2);
    header();
    for (const row of rows) {
      if (y + rowHeight > BOTTOM) {
        newPage();
        header();
      }
      let x = MARGIN;
      columns.forEach((column, index) => {
        const cell = row[index];
        const value = typeof cell === "object" && cell !== null ? cell : { text: cell };
        const size = 8.5;
        pdf.text(x + 5, y + 11.5, fitText(value.text ?? "", column.width - 10, size, value.bold), {
          size,
          bold: value.bold,
          color: value.color ?? COLORS.ink,
          align: column.align ?? "left",
          width: column.width - 10,
        });
        x += column.width;
      });
      y += rowHeight;
      pdf.line(MARGIN, y, MARGIN + CONTENT, y, { color: COLORS.line });
    }
    y += 6;
  }

  // Intestazione
  newPage();
  pdf.rect(0, 6, PAGE_WIDTH, 92, { fill: COLORS.ink });
  pdf.text(MARGIN, 44, "VIGIL · REPORT MENSILE", { size: 9, bold: true, color: "#a5b4fc" });
  const title = summary.label.charAt(0).toUpperCase() + summary.label.slice(1);
  pdf.text(MARGIN, 74, title, { size: 24, bold: true, color: "#ffffff" });
  pdf.text(MARGIN, 74, `Generato il ${stamp.format(new Date(summary.generatedAt))}`, { size: 8.5, color: "#cbd5e1", align: "right", width: CONTENT });
  y = 122;

  // Indicatori
  const k = summary.kpi;
  const tiles = [
    ["Disponibilità host", formatPercent(k.availability), availabilityColor(k.availability)],
    ["Interruzioni", String(k.outages), COLORS.ink],
    ["Fuori servizio in totale", formatDuration(k.downtimeSeconds), COLORS.ink],
    ["Tempo medio di ripristino", formatDuration(k.mttrSeconds), COLORS.ink],
    ["Host controllati", String(k.hosts), COLORS.ink],
    ["Tempo medio tra guasti", formatDuration(k.mtbfSeconds), COLORS.ink],
    ["Disponibilità servizi", formatPercent(k.serviceAvailability), availabilityColor(k.serviceAvailability)],
    ["Guasti dei servizi", `${k.serviceFailures} su ${k.services} controlli`, COLORS.ink],
  ];
  const gap = 10;
  const tileWidth = (CONTENT - gap * 3) / 4;
  tiles.forEach(([label, value, color], index) => {
    const x = MARGIN + (index % 4) * (tileWidth + gap);
    const top = y + Math.floor(index / 4) * 62;
    pdf.rect(x, top, tileWidth, 52, { fill: "#ffffff", stroke: COLORS.line, lineWidth: 0.8 });
    pdf.text(x + 10, top + 17, fitText(label, tileWidth - 20, 7.5, true).toUpperCase(), { size: 7.5, bold: true, color: COLORS.muted });
    const size = textWidth(value, 16, true) > tileWidth - 20 ? 11 : 16;
    pdf.text(x + 10, top + 40, fitText(value, tileWidth - 20, size, true), { size, bold: true, color });
  });
  y += 128;

  heading("Disponibilità per settore");
  table(
    [
      { label: "Settore", width: 190 },
      { label: "Host", width: 60, align: "right" },
      { label: "Interruzioni", width: 85, align: "right" },
      { label: "Fuori servizio", width: 85, align: "right" },
      { label: "Disponibilità", width: CONTENT - 420, align: "right" },
    ],
    summary.sectors.map((sector) => [
      sector.name || "Senza settore",
      String(sector.hosts),
      String(sector.outages),
      formatDuration(sector.downtimeSeconds),
      { text: formatPercent(sector.availability), bold: true, color: availabilityColor(sector.availability) },
    ]),
    "Nessun host controllato in questo mese.",
  );

  heading("Host con più problemi", "i 10 con la disponibilità più bassa");
  table(
    [
      { label: "Host", width: 170 },
      { label: "Settore", width: 120 },
      { label: "Interruzioni", width: 70, align: "right" },
      { label: "Fuori servizio", width: 75, align: "right" },
      { label: "Disponibilità", width: CONTENT - 435, align: "right" },
    ],
    summary.worstHosts.map((host) => [
      host.name,
      host.sector || "—",
      String(host.outages),
      formatDuration(host.downtimeSeconds),
      { text: formatPercent(host.availability), bold: true, color: availabilityColor(host.availability) },
    ]),
    "Nessuna interruzione: tutti gli host sono rimasti raggiungibili.",
  );

  heading("Servizi", "porte, siti e certificati");
  table(
    [
      { label: "Servizio", width: 150 },
      { label: "Host", width: 130 },
      { label: "Tipo", width: 45 },
      { label: "Guasti", width: 50, align: "right" },
      { label: "Fuori servizio", width: 75, align: "right" },
      { label: "Disponibilità", width: CONTENT - 450, align: "right" },
    ],
    summary.services.map((check) => [
      check.name,
      check.host,
      check.kind.toUpperCase(),
      String(check.failures),
      formatDuration(check.downtimeSeconds),
      { text: formatPercent(check.availability), bold: true, color: availabilityColor(check.availability) },
    ]),
    "Nessun controllo dei servizi configurato.",
  );

  heading("Interruzioni più lunghe", "durata dentro il mese");
  table(
    [
      { label: "Host", width: 140 },
      { label: "Inizio", width: 70 },
      { label: "Fine", width: 70 },
      { label: "Durata", width: 70, align: "right" },
      { label: "Causa", width: 90 },
      { label: "Preso in carico da", width: CONTENT - 440 },
    ],
    summary.longest.map((outage) => [
      outage.host,
      when.format(new Date(outage.startedAt)),
      outage.endedAt ? when.format(new Date(outage.endedAt)) : "in corso",
      { text: formatDuration(outage.seconds), bold: true },
      outage.cause ? `a monte: ${outage.cause}` : "—",
      outage.ackBy ?? "—",
    ]),
    "Nessuna interruzione in questo mese.",
  );

  ensure(40);
  y += 8;
  pdf.text(MARGIN, y, "Le interruzioni durante le manutenzioni programmate non sono conteggiate. Orari nel fuso " + summary.timeZone + ".", {
    size: 7.5,
    color: COLORS.muted,
  });

  // Piè di pagina con il numero di pagina
  const total = pdf.pages.length;
  pdf.pages.forEach((ops, index) => {
    pdf.current = ops;
    pdf.line(MARGIN, PAGE_HEIGHT - 34, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 34, { color: COLORS.line });
    pdf.text(MARGIN, PAGE_HEIGHT - 22, `Vigil · ${summary.label}`, { size: 7.5, color: COLORS.muted });
    pdf.text(MARGIN, PAGE_HEIGHT - 22, `Pagina ${index + 1} di ${total}`, { size: 7.5, color: COLORS.muted, align: "right", width: CONTENT });
  });
  return pdf.toBuffer(new Date(summary.generatedAt));
}
