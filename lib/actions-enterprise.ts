"use server";
// Impostazioni, scadenze dei domini, backup, report e import CSV degli host.
import { revalidatePath } from "next/cache";
import type { FormState } from "./actions";
import { audit } from "./audit";
import { requireAdmin } from "./auth";
import { parseCsv } from "./csv.mjs";
import { db, transaction } from "./db";
import { INVENTORY_FIELDS, isRowId, isUniqueViolation, text } from "./form";
import { cleanCell, HOST_COLUMNS, mapHeader, parseCsvDate, parseFlag, type HostColumn, type ImportPreview, type ImportRow } from "./host-csv";
import { collectReport, currentMonth, isMonth, monthLabel, renderReport } from "./report.mjs";
import { parseDeviceType } from "./scope";
import { isClock, isTimeZone, normalizeAlertSettings } from "./settings.mjs";
import { isValidAddress } from "./validate";
import { normalizeDomain } from "../worker/domains.mjs";

async function saveSetting(key: string, value: unknown, username: string) {
  await db().query(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), username],
  );
}

const wholeNumber = (value: string, min: number, max: number) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
};

// Impostazioni

export async function saveAlertSettingsAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const quietFrom = text(form, "quietFrom");
  const quietTo = text(form, "quietTo");
  const timeZone = text(form, "timeZone");
  const escalationMinutes = wholeNumber(text(form, "escalationMinutes"), 0, 1440);
  const warrantyDays = wholeNumber(text(form, "warrantyDays"), 1, 365);

  if (!isClock(quietFrom) || !isClock(quietTo)) return { error: "Orari non validi: usa il formato 22:00." };
  if (!isTimeZone(timeZone)) return { error: "Fuso orario non riconosciuto (esempio: Europe/Rome)." };
  if (escalationMinutes === null) return { error: "Escalation: indica i minuti, da 0 (mai) a 1440." };
  if (warrantyDays === null) return { error: "Garanzie: indica i giorni di anticipo, da 1 a 365." };

  const value = { quietEnabled: form.get("quietEnabled") === "on", quietFrom, quietTo, timeZone, escalationMinutes, warrantyDays };
  await saveSetting("alerts", value, admin.username);
  await audit(admin, "settings.alerts", null, value);
  revalidatePath("/admin/impostazioni");
  return { ok: true, message: "Impostazioni salvate. Il controllo le applica entro 30 secondi." };
}

export async function saveStatusSettingsAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const title = text(form, "title");
  const note = text(form, "note");
  if (title.length > 80) return { error: "Il titolo può avere al massimo 80 caratteri." };
  if (note.length > 500) return { error: "L'avviso può avere al massimo 500 caratteri." };

  const value = { enabled: form.get("enabled") === "on", title, note };
  await saveSetting("status", value, admin.username);
  await audit(admin, "settings.status", null, { enabled: value.enabled });
  revalidatePath("/admin/impostazioni");
  revalidatePath("/stato");
  return { ok: true, message: "Pagina di stato aggiornata." };
}

/** Il worker lo vede entro un minuto: la riga 'backup_request' più recente dell'ultimo tentativo. */
export async function requestBackupAction(): Promise<FormState> {
  const admin = await requireAdmin();
  await db().query(
    `INSERT INTO system_state (key, value, updated_at) VALUES ('backup_request', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ by: admin.username })],
  );
  await audit(admin, "backup.request");
  revalidatePath("/admin/impostazioni");
  return { ok: true, message: "Backup richiesto: parte entro un minuto. Ricarica la pagina per vederne l'esito." };
}

// Domini

const MAX_DOMAINS = 200;

export async function saveDomainAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = Number(form.get("id")) || null;
  const name = normalizeDomain(text(form, "name"));
  const warnDays = wholeNumber(text(form, "warnDays") || "30", 1, 365);

  if (!name) return { error: "Dominio non valido: scrivi solo il nome, per esempio esempio.it." };
  if (warnDays === null) return { error: "Indica con quanti giorni di anticipo avvisare (da 1 a 365)." };
  if (id !== null && !isRowId(id)) return { error: "Dominio non trovato." };

  try {
    if (id === null) {
      const { count } = (await db().query<{ count: number }>("SELECT count(*)::int AS count FROM domains")).rows[0];
      if (count >= MAX_DOMAINS) return { error: `Si possono seguire al massimo ${MAX_DOMAINS} domini.` };
      await db().query("INSERT INTO domains (name, warn_days) VALUES ($1, $2)", [name, warnDays]);
    } else {
      // Con un nome nuovo si riparte da zero: scadenza e avviso valevano per il vecchio
      const { rowCount } = await db().query(
        `UPDATE domains SET warn_days = $3,
           expires_at = CASE WHEN name = $2 THEN expires_at END,
           registrar = CASE WHEN name = $2 THEN registrar END,
           source = CASE WHEN name = $2 THEN source END,
           checked_at = CASE WHEN name = $2 THEN checked_at END,
           error = CASE WHEN name = $2 THEN error END,
           alerted_for = CASE WHEN name = $2 AND warn_days = $3 THEN alerted_for END,
           name = $2
         WHERE id = $1`,
        [id, name, warnDays],
      );
      if (!rowCount) return { error: "Dominio non trovato." };
    }
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "Questo dominio è già nell'elenco." };
    throw error;
  }

  await audit(admin, "domain.save", name, { warnDays });
  revalidatePath("/admin/scadenze");
  return { ok: true, message: id === null ? "Dominio aggiunto: la scadenza arriva entro qualche minuto." : undefined };
}

export async function deleteDomainAction(form: FormData) {
  const admin = await requireAdmin();
  const id = Number(form.get("id"));
  if (!isRowId(id)) return;
  const { rows } = await db().query<{ name: string }>("DELETE FROM domains WHERE id = $1 RETURNING name", [id]);
  if (rows[0]) await audit(admin, "domain.delete", rows[0].name);
  revalidatePath("/admin/scadenze");
}

/** Il worker ricontrolla per primi i domini mai controllati. */
export async function recheckDomainAction(form: FormData) {
  const admin = await requireAdmin();
  const id = Number(form.get("id"));
  if (!isRowId(id)) return;
  const { rows } = await db().query<{ name: string }>(
    "UPDATE domains SET checked_at = NULL WHERE id = $1 RETURNING name",
    [id],
  );
  if (rows[0]) await audit(admin, "domain.recheck", rows[0].name);
  revalidatePath("/admin/scadenze");
}

// Report

/** Ricalcola il report di un mese chiuso, per esempio dopo aver corretto delle manutenzioni. */
export async function regenerateReportAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const month = text(form, "month");
  const { rows } = await db().query<{ value: unknown }>("SELECT value FROM settings WHERE key = 'alerts'");
  const { timeZone } = normalizeAlertSettings(rows[0]?.value);

  if (!isMonth(month)) return { error: "Mese non valido." };
  if (month >= currentMonth(new Date(), timeZone)) return { error: "Il mese in corso non è ancora chiuso." };

  const summary = await collectReport(
    (sql: string, params: unknown[]) => db().query(sql, params).then((result) => result.rows),
    { month, timeZone },
  );
  const pdf = renderReport(summary);
  await db().query(
    `INSERT INTO reports (month, summary, pdf) VALUES ($1::date, $2, $3)
     ON CONFLICT (month) DO UPDATE SET summary = EXCLUDED.summary, pdf = EXCLUDED.pdf, created_at = now()`,
    [`${month}-01`, JSON.stringify(summary), pdf],
  );
  await audit(admin, "report.generate", monthLabel(month));
  revalidatePath("/admin/report");
  return { ok: true, message: `Report di ${monthLabel(month)} rigenerato.` };
}

// Import CSV degli host

const MAX_BYTES = 1_000_000;
const MAX_ROWS = 2000;

interface Entry extends ImportRow {
  /** Colonna del database → valore, solo per le colonne presenti nel file. */
  values: Map<string, unknown>;
  /** Riferimento al dispositivo a monte. undefined: colonna assente; "": nessuno. */
  parentRef?: string;
  existingId: number | null;
  parentId?: number | null;
}

const INVENTORY_BY_KEY = new Map<string, (typeof INVENTORY_FIELDS)[number]>(
  INVENTORY_FIELDS.map((field) => [field.key, field]),
);

function decimal(value: string, min: number, max: number) {
  if (!value) return null;
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

/** Legge una riga: errori e valori, senza ancora toccare il database. */
function readRow(cells: string[], columns: (HostColumn | null)[], line: number): Entry {
  const cell = (key: HostColumn) => {
    const index = columns.indexOf(key);
    return index < 0 ? undefined : cleanCell(cells[index] ?? "");
  };
  const address = cell("address") ?? "";
  const name = cell("name") || address;
  const entry: Entry = { line, name, address, action: "create", note: "", values: new Map(), existingId: null };
  const fail = (note: string) => Object.assign(entry, { action: "error" as const, note });

  if (!isValidAddress(address)) return fail(address ? "Indirizzo non valido." : "Manca l'indirizzo.");
  if (name.length > 80) return fail("Nome oltre gli 80 caratteri.");
  if (cell("name")) entry.values.set("name", name);

  for (const column of columns) {
    if (!column || column === "name" || column === "address") continue;
    const value = cell(column) ?? "";
    switch (column) {
      case "sector":
        if (value.length > 40) return fail("Settore oltre i 40 caratteri.");
        entry.values.set("group_name", value);
        break;
      case "type": {
        if (!value) break;
        const type = parseDeviceType(value);
        if (!type) return fail(`Tipo "${value.slice(0, 30)}" non riconosciuto.`);
        entry.values.set("device_type", type);
        break;
      }
      case "ping": {
        const flag = parseFlag(value);
        if (flag === undefined) return fail("Ping: scrivi sì o no.");
        if (flag !== null) entry.values.set("ping_enabled", flag);
        break;
      }
      case "critical": {
        const flag = parseFlag(value);
        if (flag === undefined) return fail("Critico: scrivi sì o no.");
        entry.values.set("critical", flag ?? false);
        break;
      }
      case "publicLabel":
        if (value.length > 80) return fail("Nome pubblico oltre gli 80 caratteri.");
        entry.values.set("public_label", value || null);
        break;
      case "latencyWarn": {
        const number = decimal(value, 0.1, 60_000);
        if (number === undefined) return fail("Soglia di latenza non valida.");
        entry.values.set("latency_warn_ms", number);
        break;
      }
      case "lossWarn": {
        const number = decimal(value, 0, 100);
        if (number === undefined) return fail("Soglia di perdita non valida.");
        entry.values.set("loss_warn_pct", number);
        break;
      }
      case "purchasedOn":
      case "warrantyUntil": {
        const day = parseCsvDate(value);
        if (day === undefined) return fail("Data non valida: usa GG/MM/AAAA o AAAA-MM-GG.");
        entry.values.set(column === "purchasedOn" ? "purchased_on" : "warranty_until", day);
        break;
      }
      case "parent":
        entry.parentRef = value;
        break;
      default: {
        const field = INVENTORY_BY_KEY.get(column);
        if (!field) break;
        if (value.length > field.max) return fail(`${field.label} supera i ${field.max} caratteri.`);
        entry.values.set(field.column, value || null);
      }
    }
  }
  return entry;
}

/** Vero se, seguendo i collegamenti verso l'alto da `start`, si torna a `start`. */
function makesLoop(start: string, parents: Map<string, string | null>) {
  const seen = new Set<string>();
  let current = parents.get(start) ?? null;
  while (current !== null) {
    if (current === start) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}

/**
 * Due passaggi: senza `confirm` restituisce l'anteprima, con `confirm` scrive le righe valide.
 * Modalità "new": gli indirizzi già presenti si saltano. "update": si aggiornano le sole colonne del file.
 */
export async function importHostsCsvAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const mode = text(form, "mode") === "update" ? "update" : "new";
  const confirm = form.get("confirm") === "1";

  let input = String(form.get("csv") ?? "");
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return { error: "Il file supera 1 MB." };
    input = await file.text();
  }
  if (input.length > MAX_BYTES) return { error: "Il testo supera 1 MB." };
  if (!input.trim()) return { error: "Scegli un file CSV oppure incolla le righe." };

  const { rows } = parseCsv(input);
  const [header = [], ...lines] = rows;
  const columns = mapHeader(header);
  if (!columns.includes("address")) {
    return { error: "Nella prima riga manca la colonna Indirizzo (o Address, IP). Scarica l'export per un esempio." };
  }
  if (lines.length === 0) return { error: "Il file contiene solo l'intestazione." };
  if (lines.length > MAX_ROWS) return { error: `Al massimo ${MAX_ROWS} righe per volta.` };

  const entries = lines.map((cells, index) => readRow(cells, columns, index + 2));

  const existing = (
    await db().query<{ id: number; name: string; address: string; parent_id: number | null }>(
      "SELECT id, name, address, parent_id FROM hosts",
    )
  ).rows;
  const byAddress = new Map(existing.map((host) => [host.address.toLowerCase(), host]));

  // Righe ripetute e indirizzi già presenti
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.action === "error") continue;
    const key = entry.address.toLowerCase();
    if (seen.has(key)) {
      Object.assign(entry, { action: "error", note: "Indirizzo ripetuto nel file." });
      continue;
    }
    seen.add(key);
    const host = byAddress.get(key);
    if (!host) continue;
    entry.existingId = host.id;
    if (mode === "new") Object.assign(entry, { action: "skip", note: "Già presente." });
    else entry.action = "update";
  }

  // Collegamenti: per indirizzo, poi per nome, tra gli host esistenti e le righe nuove del file
  const nodeOf = (entry: Entry) => (entry.existingId !== null ? `h${entry.existingId}` : `r${entry.line}`);
  const targets = new Map<string, string>();
  const names = new Map<string, Set<string>>();
  const addName = (name: string, node: string) => {
    const key = name.trim().toLowerCase();
    if (!names.has(key)) names.set(key, new Set());
    names.get(key)!.add(node);
  };
  for (const host of existing) {
    targets.set(host.address.toLowerCase(), `h${host.id}`);
    addName(host.name, `h${host.id}`);
  }
  for (const entry of entries) {
    if (entry.action !== "create") continue;
    targets.set(entry.address.toLowerCase(), nodeOf(entry));
    addName(entry.name, nodeOf(entry));
  }

  const parents = new Map<string, string | null>(
    existing.map((host) => [`h${host.id}`, host.parent_id === null ? null : `h${host.parent_id}`]),
  );
  for (const entry of entries) {
    if (entry.action !== "create" && entry.action !== "update") continue;
    const node = nodeOf(entry);
    if (entry.action === "create") parents.set(node, null);
    if (entry.parentRef === undefined) continue;

    const ref = entry.parentRef.trim().toLowerCase();
    let target: string | null = null;
    if (ref) {
      const byName = names.get(ref);
      target = targets.get(ref) ?? (byName?.size === 1 ? [...byName][0] : null);
      if (!target) {
        entry.note = byName && byName.size > 1 ? "Collegamento ambiguo: usa l'indirizzo." : "Collegamento non trovato.";
        continue;
      }
    }
    const previous = parents.get(node) ?? null;
    parents.set(node, target);
    if (target !== null && makesLoop(node, parents)) {
      parents.set(node, previous);
      entry.note = "Collegamento ignorato: creerebbe un giro.";
      continue;
    }
    entry.parentId = target === null ? null : -1; // risolto dopo gli inserimenti
    entry.values.set("__parent", target);
  }

  const counts = { create: 0, update: 0, skip: 0, error: 0 };
  for (const entry of entries) counts[entry.action]++;
  const recognized = HOST_COLUMNS.filter((column) => columns.includes(column.key)).map((column) => column.header);
  const ignored = header.filter((_cell, index) => columns[index] === null).map((cell) => cell.slice(0, 40));
  const preview = (applied: boolean): ImportPreview => ({
    rows: entries.map(({ line, name, address, action, note }) => ({ line, name, address, action, note })),
    counts,
    columns: recognized,
    ignored,
    mode,
    applied,
  });

  if (!confirm) return { ok: true, data: preview(false) };
  if (counts.create + counts.update === 0) return { error: "Nessuna riga da importare.", data: preview(false) };

  try {
    await transaction(async (client) => {
      const ids = new Map<string, number>(existing.map((host) => [`h${host.id}`, host.id]));
      for (const entry of entries) {
        if (entry.action !== "create" && entry.action !== "update") continue;
        const values = [...entry.values].filter(([column]) => column !== "__parent");
        if (entry.action === "create") {
          const columnsSql = ["address", ...values.map(([column]) => column)];
          if (!entry.values.has("name")) columnsSql.push("name");
          const params = [entry.address, ...values.map(([, value]) => value)];
          if (!entry.values.has("name")) params.push(entry.name);
          const { rows: inserted } = await client.query<{ id: number }>(
            `INSERT INTO hosts (${columnsSql.join(", ")}) VALUES (${params.map((_v, i) => `$${i + 1}`).join(", ")})
             RETURNING id`,
            params,
          );
          ids.set(nodeOf(entry), inserted[0].id);
        } else if (values.length > 0) {
          const sets = values.map(([column], index) => `${column} = $${index + 2}`);
          const warranty = values.findIndex(([column]) => column === "warranty_until");
          if (warranty >= 0) {
            sets.push(
              `warranty_alerted_for = CASE WHEN warranty_until IS DISTINCT FROM $${warranty + 2}::date THEN NULL ELSE warranty_alerted_for END`,
            );
          }
          await client.query(`UPDATE hosts SET ${sets.join(", ")} WHERE id = $1`, [
            entry.existingId,
            ...values.map(([, value]) => value),
          ]);
        }
      }
      // Secondo passaggio: ora anche le righe nuove hanno un id
      for (const entry of entries) {
        if (!entry.values.has("__parent")) continue;
        const target = entry.values.get("__parent") as string | null;
        const id = ids.get(nodeOf(entry));
        const parentId = target === null ? null : (ids.get(target) ?? null);
        if (id !== undefined) await client.query("UPDATE hosts SET parent_id = $2 WHERE id = $1", [id, parentId]);
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "Un indirizzo è stato aggiunto nel frattempo: rifai l'anteprima." };
    throw error;
  }

  await audit(admin, "host.import", `${counts.create} nuovi, ${counts.update} aggiornati`, { mode, ...counts });
  revalidatePath("/admin/host");
  revalidatePath("/inventario");
  revalidatePath("/");
  const done = [
    counts.create && (counts.create === 1 ? "1 host aggiunto" : `${counts.create} host aggiunti`),
    counts.update && (counts.update === 1 ? "1 aggiornato" : `${counts.update} aggiornati`),
  ].filter(Boolean);
  return { ok: true, message: `${done.join(", ")}.`, data: preview(true) };
}
