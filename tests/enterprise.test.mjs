import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { parseCsv, safeCell, toCsv } from "../lib/csv.mjs";
import { PdfDocument, fitText, textWidth } from "../lib/pdf.mjs";
import { formatDuration, monthLabel, previousMonth, renderReport, summarizeReport } from "../lib/report.mjs";
import { isQuietTime, normalizeAlertSettings, normalizeStatusSettings } from "../lib/settings.mjs";
import {
  base32Decode,
  base32Encode,
  findRecoveryCode,
  hashRecoveryCode,
  hotp,
  newRecoveryCodes,
  totp,
  verifyTotp,
} from "../lib/totp.mjs";
import { layoutTree, pathToRoot } from "../lib/tree.mjs";
import { backupFileName, pgEnvFromUrl, pickOld } from "../worker/backup.mjs";
import {
  normalizeDomain,
  parseLooseDate,
  parseRdap,
  parseWhoisExpiry,
  rdapServerFor,
  whoisReferral,
} from "../worker/domains.mjs";

const quiet = (from, to, extra = {}) => normalizeAlertSettings({ quietEnabled: true, quietFrom: from, quietTo: to, ...extra });

test("ore di silenzio a cavallo della mezzanotte, nel fuso di Roma", () => {
  const settings = quiet("22:00", "07:00");
  assert.equal(isQuietTime(new Date("2026-11-08T22:30:00Z"), settings), true); // 23:30
  assert.equal(isQuietTime(new Date("2026-11-08T05:59:00Z"), settings), true); // 06:59
  assert.equal(isQuietTime(new Date("2026-11-08T06:00:00Z"), settings), false); // 07:00
  assert.equal(isQuietTime(new Date("2026-11-08T11:00:00Z"), settings), false);
  // In estate Roma è a UTC+2
  assert.equal(isQuietTime(new Date("2026-07-01T20:00:00Z"), settings), true); // 22:00
  assert.equal(isQuietTime(new Date("2026-07-01T19:59:00Z"), settings), false);
});

test("ore di silenzio nello stesso giorno, spente o con inizio uguale alla fine", () => {
  assert.equal(isQuietTime(new Date("2026-11-08T12:00:00Z"), quiet("09:00", "17:00")), true);
  assert.equal(isQuietTime(new Date("2026-11-08T17:00:00Z"), quiet("09:00", "17:00")), false);
  assert.equal(isQuietTime(new Date("2026-11-08T22:30:00Z"), quiet("08:00", "08:00")), false);
  assert.equal(isQuietTime(new Date("2026-11-08T22:30:00Z"), normalizeAlertSettings({ quietFrom: "22:00", quietTo: "07:00" })), false);
});

test("impostazioni: valori non validi tornano ai predefiniti", () => {
  const settings = normalizeAlertSettings({ quietEnabled: "sì", quietFrom: "25:00", timeZone: "Marte/Olympus", escalationMinutes: -3, warrantyDays: 1.5 });
  assert.deepEqual(settings, {
    quietEnabled: false,
    quietFrom: "22:00",
    quietTo: "07:00",
    timeZone: "Europe/Rome",
    escalationMinutes: 15,
    warrantyDays: 30,
  });
  assert.equal(normalizeAlertSettings({ escalationMinutes: 0 }).escalationMinutes, 0);
  assert.deepEqual(normalizeStatusSettings({ enabled: true, title: "  " }), { enabled: true, title: "Stato dei servizi", note: "" });
});

test("TOTP: vettori della RFC 6238 (SHA-1)", () => {
  const key = Buffer.from("12345678901234567890");
  assert.equal(base32Encode(key), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq"), key);
  assert.equal(base32Decode("ABC1"), null);
  const vectors = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [seconds, code] of vectors) {
    assert.equal(totp(key, seconds, 8), code);
    assert.equal(totp(key, seconds), code.slice(2));
  }
  assert.equal(hotp(key, 0), "755224"); // RFC 4226
});

test("TOTP: finestra di un passo e nessun riuso dello stesso codice", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  const code = totp(base32Decode(secret), 1111111111);
  const step = verifyTotp(secret, code, 1111111111);
  assert.equal(step, Math.floor(1111111111 / 30));
  assert.equal(verifyTotp(secret, code, 1111111111 + 30), step); // telefono indietro di un passo
  assert.equal(verifyTotp(secret, code, 1111111111 + 90), null);
  assert.equal(verifyTotp(secret, code, 1111111111, step), null);
  assert.equal(verifyTotp(secret, "12345", 1111111111), null);
  assert.equal(verifyTotp(secret, "abcdef", 1111111111), null);
});

test("codici di recupero: formato, hash e ricerca", () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.ok(codes.every((code) => /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(code)));
  const hashes = codes.map(hashRecoveryCode);
  assert.equal(findRecoveryCode(hashes, codes[3].toLowerCase().replace("-", " ")), 3);
  assert.equal(findRecoveryCode(hashes, "AAAAA-AAAAA"), -1);
  assert.equal(findRecoveryCode(hashes, "123456"), -1);
});

test("CSV: separatore riconosciuto, BOM, virgolette e a capo", () => {
  const text = '\uFEFFnome;indirizzo;note\r\n"Switch; piano 1";10.0.0.1;"dice ""ciao""\nseconda riga"\r\n\r\nNAS;10.0.0.2;\r\n';
  const { delimiter, rows } = parseCsv(text);
  assert.equal(delimiter, ";");
  assert.deepEqual(rows, [
    ["nome", "indirizzo", "note"],
    ["Switch; piano 1", "10.0.0.1", 'dice "ciao"\nseconda riga'],
    ["NAS", "10.0.0.2", ""],
  ]);
  assert.equal(parseCsv("a,b\n1,2").delimiter, ",");
  assert.equal(parseCsv("a\tb\n1\t2").delimiter, "\t");
  assert.deepEqual(parseCsv("a;b").rows, [["a", "b"]]);
});

test("CSV: niente formule eseguibili, numeri intatti, andata e ritorno", () => {
  assert.equal(safeCell("=HYPERLINK(\"x\")"), "'=HYPERLINK(\"x\")");
  assert.equal(safeCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(safeCell("-5"), "-5");
  assert.equal(safeCell("+39 06 1234"), "'+39 06 1234");
  assert.equal(safeCell(null), "");
  const rows = [["nome", "nota"], ["PC; ufficio", 'virgolette "doppie"'], ["Stampante", "a capo\nqui"]];
  const csv = toCsv(rows);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.deepEqual(parseCsv(csv).rows, rows);
});

test("topologia: colonne per profondità, genitore a metà dei figli, cicli spezzati", () => {
  const hosts = [
    { id: 1, parentId: null, name: "Router" },
    { id: 2, parentId: 1, name: "Switch A" },
    { id: 3, parentId: 1, name: "Switch B" },
    { id: 4, parentId: 2, name: "PC 1" },
    { id: 5, parentId: 2, name: "PC 2" },
    { id: 6, parentId: null, name: "Isolato" },
    { id: 7, parentId: 8, name: "Giro A" },
    { id: 8, parentId: 7, name: "Giro B" },
    { id: 9, parentId: 99, name: "Genitore nascosto" },
  ];
  const layout = layoutTree(hosts);
  assert.equal(layout.nodes.get(4).depth, 2);
  assert.equal(layout.nodes.get(4).row, 0);
  assert.equal(layout.nodes.get(5).row, 1);
  assert.equal(layout.nodes.get(2).row, 0.5);
  assert.equal(layout.nodes.get(3).row, 2);
  assert.equal(layout.nodes.get(1).row, 1.25);
  assert.deepEqual(layout.alone.sort(), [6, 7, 8, 9]);
  assert.equal(layout.depth, 3);
  assert.equal(layout.edges.length, 4);
  assert.deepEqual(pathToRoot(4, new Map([[4, 2], [2, 1], [1, null]])), [4, 2, 1]);
  assert.deepEqual(pathToRoot(7, new Map([[7, 8], [8, 7]])), [7, 8]);
});

function checkPdf(buffer) {
  const text = buffer.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  const startxref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.ok(text.slice(startxref).startsWith("xref"));
  const entries = text.slice(startxref).split("\n").slice(3).filter((line) => / 00000 n $/.test(line));
  entries.forEach((line, index) => {
    const offset = Number(line.slice(0, 10));
    assert.ok(text.slice(offset).startsWith(`${index + 1} 0 obj`), `oggetto ${index + 1} fuori posto`);
  });
  return text;
}

test("PDF: struttura valida, offset esatti, accenti in WinAnsi", () => {
  const pdf = new PdfDocument({ title: "Prova (1)" });
  pdf.text(40, 40, "Disponibilità è più (alta) \\ €", { bold: true }).rect(40, 50, 100, 20, { fill: "#4f46e5" }).line(40, 80, 200, 80);
  pdf.addPage().text(40, 40, "seconda");
  const text = checkPdf(pdf.toBuffer(new Date("2026-11-01T00:00:00Z")));
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/Title \(Prova \\\(1\\\)\)/);
  const stream = /stream\n([\s\S]*?)\nendstream/.exec(text)[1];
  const content = inflateSync(Buffer.from(stream, "latin1")).toString("latin1");
  assert.match(content, /\(Disponibilit\\340 \\350 pi\\371 \\\(alta\\\) \\\\ \\200\) Tj/);
  assert.equal(textWidth("Ai", 10), 8.89);
  assert.equal(textWidth("à", 10), textWidth("a", 10));
  assert.ok(textWidth(fitText("un testo molto lungo da tagliare", 50, 10), 10) <= 50);
});

test("report: disponibilità, MTTR e MTBF dai dati del mese", () => {
  const month = 30 * 86400;
  const summary = summarizeReport({
    month: "2026-10",
    timeZone: "Europe/Rome",
    from: new Date("2026-09-30T22:00:00Z"),
    to: new Date("2026-10-31T23:00:00Z"),
    generatedAt: new Date("2026-11-01T00:05:00Z"),
    hosts: [
      { id: 1, name: "Router", group_name: "Rete", period: month },
      { id: 2, name: "NAS", group_name: "Server", period: month },
    ],
    outages: [
      { host_id: 1, started_at: "2026-10-02T10:00:00Z", ended_at: "2026-10-02T11:00:00Z", seconds: 3600, repair_seconds: 3600, cause_name: null, ack_by: "admin" },
      { host_id: 1, started_at: "2026-10-31T22:30:00Z", ended_at: null, seconds: 1800, repair_seconds: null, cause_name: null, ack_by: null },
    ],
    services: [{ id: 1, name: "Sito", kind: "http", host_name: "NAS", period: month, failures: 1, down: 600 }],
  });
  assert.equal(summary.label, "ottobre 2026");
  assert.equal(summary.kpi.outages, 2);
  assert.equal(summary.kpi.downtimeSeconds, 5400);
  assert.equal(summary.kpi.mttrSeconds, 3600);
  assert.equal(summary.kpi.mtbfSeconds, (2 * month - 5400) / 2);
  assert.equal(summary.kpi.availability, (1 - 5400 / (2 * month)) * 100);
  assert.equal(summary.worstHosts.length, 1);
  assert.equal(summary.worstHosts[0].name, "Router");
  assert.equal(summary.sectors[0].name, "Rete");
  assert.equal(summary.longest[0].seconds, 3600);
  assert.equal(summary.services[0].availability, (1 - 600 / month) * 100);
  checkPdf(renderReport(summary));
  // Un mese vuoto non rompe l'impaginazione
  checkPdf(renderReport(summarizeReport({ ...summary, from: new Date(), to: new Date(), generatedAt: new Date(), hosts: [], outages: [], services: [] })));
});

test("report: mese precedente nel fuso e durate leggibili", () => {
  assert.equal(previousMonth(new Date("2026-11-01T00:30:00+01:00"), "Europe/Rome"), "2026-10");
  assert.equal(previousMonth(new Date("2026-10-31T23:30:00Z"), "Europe/Rome"), "2026-10");
  assert.equal(previousMonth(new Date("2027-01-15T12:00:00Z"), "Europe/Rome"), "2026-12");
  assert.equal(monthLabel("2026-03"), "marzo 2026");
  assert.equal(formatDuration(45), "45 s");
  assert.equal(formatDuration(3600 * 2 + 60 * 14), "2 h 14 min");
  assert.equal(formatDuration(86400 * 3 + 3600 * 4), "3 g 4 h");
  assert.equal(formatDuration(null), "—");
});

test("domini: pulizia del nome, server RDAP e scadenza", () => {
  assert.equal(normalizeDomain(" https://Esempio.IT/percorso "), "esempio.it");
  assert.equal(normalizeDomain("perché.it"), "xn--perch-fsa.it");
  assert.equal(normalizeDomain("10.0.0.1"), null);
  assert.equal(normalizeDomain("localhost"), null);
  assert.equal(normalizeDomain("-sbagliato.com"), null);
  const bootstrap = { services: [[["com", "net"], ["http://rdap.example/", "https://rdap.example/com"]], [["it"], ["https://rdap.nic.example/"]]] };
  assert.equal(rdapServerFor(bootstrap, "esempio.com"), "https://rdap.example/com/");
  assert.equal(rdapServerFor(bootstrap, "esempio.it"), "https://rdap.nic.example/");
  assert.equal(rdapServerFor(bootstrap, "esempio.org"), null);
  const parsed = parseRdap({
    events: [{ eventAction: "registration", eventDate: "2010-01-01T00:00:00Z" }, { eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" }],
    entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Registrar di prova"]]] }],
  });
  assert.equal(parsed.expiresAt.toISOString(), "2027-08-13T04:00:00.000Z");
  assert.equal(parsed.registrar, "Registrar di prova");
  assert.deepEqual(parseRdap({}), { expiresAt: null, registrar: null });
});

test("domini: risposte WHOIS di registri diversi", () => {
  assert.equal(whoisReferral("domain:       IT\n\nrefer:        whois.nic.it\n"), "whois.nic.it");
  assert.equal(parseWhoisExpiry("Domain:  esempio.it\nCreated:  2001-01-01 00:00:00\nExpire Date:  2027-03-15\n").toISOString(), "2027-03-15T00:00:00.000Z");
  assert.equal(parseWhoisExpiry("   Registry Expiry Date: 2027-08-13T04:00:00Z\n").toISOString(), "2027-08-13T04:00:00.000Z");
  assert.equal(parseWhoisExpiry("paid-till:     2027-01-20T21:00:00Z\n").toISOString(), "2027-01-20T21:00:00.000Z");
  assert.equal(parseWhoisExpiry("Expiration Date: 15-Mar-2027\n").toISOString(), "2027-03-15T00:00:00.000Z");
  assert.equal(parseWhoisExpiry("Status: AVAILABLE\n"), null);
  assert.equal(parseLooseDate("2027-03-15T10:00:00+02:00").toISOString(), "2027-03-15T08:00:00.000Z");
  assert.equal(parseLooseDate("15.03.2027").toISOString(), "2027-03-15T00:00:00.000Z");
});

test("backup: variabili PG*, nomi dei file e rotazione", () => {
  assert.deepEqual(pgEnvFromUrl("postgres://vigil:p%40ss%3Aw@127.0.0.1:5433/vigil?sslmode=disable"), {
    PGHOST: "127.0.0.1",
    PGPORT: "5433",
    PGUSER: "vigil",
    PGPASSWORD: "p@ss:w",
    PGDATABASE: "vigil",
    PGSSLMODE: "disable",
  });
  assert.throws(() => pgEnvFromUrl("mysql://x@y/z"));
  assert.equal(backupFileName(new Date("2026-11-08T07:05:09.123Z")), "vigil-20261108-070509.dump");
  const names = ["vigil-20261101-000000.dump", "vigil-20261103-000000.dump", "vigil-20261102-000000.dump", "altro.txt", "vigil-20261104-000000.dump.partial"];
  assert.deepEqual(pickOld(names, 2), ["vigil-20261101-000000.dump"]);
  assert.deepEqual(pickOld(names, 0), ["vigil-20261102-000000.dump", "vigil-20261101-000000.dump"]);
});
