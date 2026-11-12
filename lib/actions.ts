"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";
import { audit } from "./audit";
import {
  clearLoginChallenge,
  createLoginChallenge,
  createSession,
  destroySession,
  getUser,
  newDeviceToken,
  requireAdmin,
  requireUser,
  spendChallengeAttempt,
} from "./auth";
import { db, transaction } from "./db";
import { INVENTORY_FIELDS, isForeignKeyViolation, isRowId, isUniqueViolation, parseDay, text } from "./form";
import { clearFailures, lockedMinutes, recordFailure } from "./login-limit";
import { hashPassword, verifyPassword } from "./password.mjs";
import { parsePositions, PLAN_MAX_BYTES, sniffImage } from "./plan.mjs";
import { parseRange } from "./ranges";
import { DEVICE_TYPES, isDeviceType, isGroupBy, isPanel, isViewMode, type DeviceType } from "./scope";
import { parseSubnet } from "./subnet.mjs";
import { findRecoveryCode, verifyTotp } from "./totp.mjs";
import { isValidAddress, isValidCheckUrl, isValidPassword, isValidUsername } from "./validate";

export type FormState =
  | {
      ok?: boolean;
      error?: string;
      message?: string;
      id?: number;
      token?: string;
      /** Accesso: quale passo mostrare dopo questa risposta. */
      next?: "totp" | "password";
      /** Dati di ritorno per il modulo (anteprime, codici da mostrare una volta). */
      data?: unknown;
    }
  | undefined;


/** Campo numerico facoltativo. Vuoto: null. Non valido: undefined. */
function parseLimit(value: string, min: number, max: number) {
  if (!value) return null;
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

const LATENCY_MAX_MS = 60_000;

// Con un utente inesistente si esegue comunque una verifica: i tempi di risposta
// non devono rivelare quali nomi utente esistono.
let decoyHash: Promise<string> | undefined;
const getDecoyHash = () => (decoyHash ??= hashPassword(randomBytes(16).toString("hex")));

const loginAddress = async () => (await headers()).get("x-real-ip") ?? "locale";
const auditName = (username: string) => username.slice(0, 64);

/** Un tentativo sbagliato: conta per il blocco e, se è quello che blocca, finisce nel registro. */
async function loginFailed(address: string, username: string, action: string, userId: number | null = null) {
  recordFailure(address, username);
  await audit({ id: userId, username: auditName(username) }, action);
  if (lockedMinutes(address, username) > 0) await audit({ id: userId, username: auditName(username) }, "login.locked");
}

async function finishLogin(address: string, userId: number, username: string, action = "login.ok"): Promise<never> {
  clearFailures(address, username);
  await clearLoginChallenge();
  await db().query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
  await createSession(userId);
  await audit({ id: userId, username }, action);
  redirect("/");
}

export async function loginAction(_state: FormState, form: FormData): Promise<FormState> {
  const username = text(form, "username");
  const password = String(form.get("password") ?? "");
  if (!username || !password) return { error: "Inserisci nome utente e password." };

  const address = await loginAddress();
  const minutes = lockedMinutes(address, username);
  if (minutes > 0) return { error: `Troppi tentativi. Riprova tra ${minutes} min.` };

  const { rows } = await db().query<{ id: number; username: string; password_hash: string; totp_enabled: boolean }>(
    "SELECT id, username, password_hash, totp_enabled FROM users WHERE lower(username) = lower($1)",
    [username],
  );
  const user = rows[0];
  const valid = await verifyPassword(password.slice(0, 128), user?.password_hash ?? (await getDecoyHash()));

  if (!user || !valid) {
    await loginFailed(address, username, "login.failed", user?.id ?? null);
    return { error: "Nome utente o password non corretti." };
  }

  // Con i due fattori la sessione nasce solo dopo il codice
  if (user.totp_enabled) {
    await createLoginChallenge(user.id);
    return { ok: true, next: "totp" };
  }
  return finishLogin(address, user.id, user.username);
}

/** Secondo passo: il codice dell'app oppure uno dei codici di recupero, che vale una volta sola. */
export async function verifyTotpAction(_state: FormState, form: FormData): Promise<FormState> {
  const code = text(form, "code");
  if (!code) return { error: "Inserisci il codice.", next: "totp" };

  const userId = await spendChallengeAttempt();
  if (userId === null) {
    await clearLoginChallenge();
    return { error: "Tempo scaduto o troppi tentativi: inserisci di nuovo la password.", next: "password" };
  }

  const { rows } = await db().query<{
    username: string;
    totp_secret: string | null;
    totp_last_step: string | null;
    recovery_codes: Buffer[];
  }>("SELECT username, totp_secret, totp_last_step, recovery_codes FROM users WHERE id = $1 AND totp_enabled", [
    userId,
  ]);
  const user = rows[0];
  if (!user?.totp_secret) {
    await clearLoginChallenge();
    return { error: "Inserisci di nuovo la password.", next: "password" };
  }

  const address = await loginAddress();
  const minutes = lockedMinutes(address, user.username);
  if (minutes > 0) {
    await clearLoginChallenge();
    return { error: `Troppi tentativi. Riprova tra ${minutes} min.`, next: "password" };
  }

  const step = verifyTotp(user.totp_secret, code, Date.now() / 1000, user.totp_last_step);
  if (step !== null) {
    // La condizione impedisce che due richieste simultanee usino lo stesso codice
    const { rowCount } = await db().query(
      "UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)",
      [userId, step],
    );
    if (rowCount) return finishLogin(address, userId, user.username);
  }

  const index = findRecoveryCode(user.recovery_codes ?? [], code);
  if (index >= 0) {
    const { rowCount } = await db().query(
      "UPDATE users SET recovery_codes = array_remove(recovery_codes, $2::bytea) WHERE id = $1 AND $2::bytea = ANY(recovery_codes)",
      [userId, user.recovery_codes[index]],
    );
    if (rowCount) return finishLogin(address, userId, user.username, "login.recovery");
  }

  await loginFailed(address, user.username, "login.2fa_failed", userId);
  return { error: "Codice non corretto.", next: "totp" };
}

/** Torna alla password senza aspettare la scadenza del secondo passo. */
export async function cancelTotpAction() {
  await clearLoginChallenge();
}

export async function logoutAction() {
  const user = await getUser();
  await destroySession();
  if (user) await audit(user, "logout");
  redirect("/login");
}

export async function changeOwnPasswordAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");

  if (!isValidPassword(next)) return { error: "La nuova password deve avere da 8 a 128 caratteri." };
  if (next !== String(form.get("confirm") ?? "")) return { error: "Le due password non coincidono." };

  const { rows } = await db().query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [user.id],
  );
  if (!rows[0] || !(await verifyPassword(current.slice(0, 128), rows[0].password_hash))) {
    return { error: "La password attuale non è corretta." };
  }

  await transaction(async (client) => {
    await client.query("UPDATE users SET password_hash = $2 WHERE id = $1", [user.id, await hashPassword(next)]);
    await client.query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
  });
  await createSession(user.id);
  await audit(user, "password.change");
  return { ok: true, message: "Password aggiornata." };
}

// Host

const CHECK_RESET = `status = 'unknown', since = NULL, last_check = NULL, last_ms = NULL,
  detail = '', fail_streak = 0, fail_since = NULL, alerted = false`;

async function resetMonitoring(client: PoolClient, hostId: number) {
  await client.query("UPDATE outages SET ended_at = now() WHERE host_id = $1 AND ended_at IS NULL", [hostId]);
  await client.query("DELETE FROM host_state WHERE host_id = $1", [hostId]);
  await client.query(
    `UPDATE service_outages SET ended_at = now()
     WHERE ended_at IS NULL AND check_id IN (SELECT id FROM service_checks WHERE host_id = $1)`,
    [hostId],
  );
  await client.query(`UPDATE service_checks SET ${CHECK_RESET} WHERE host_id = $1`, [hostId]);
}

function revalidateHosts() {
  revalidatePath("/admin/host");
  revalidatePath("/");
}

const LOOP_ERROR = "Collegamento non valido: un dispositivo non può dipendere da se stesso o da chi dipende da lui.";

/** Risale da `parent`: se incontra uno degli host da collegare, si chiuderebbe un cerchio. */
async function wouldLoop(ids: number[], parent: number) {
  const { rowCount } = await db().query(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_id FROM hosts WHERE id = $1
       UNION
       SELECT h.id, h.parent_id FROM hosts h JOIN chain c ON h.id = c.parent_id
     )
     SELECT 1 FROM chain WHERE id = ANY($2::int[]) LIMIT 1`,
    [parent, ids],
  );
  return (rowCount ?? 0) > 0;
}

export async function saveHostAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = Number(form.get("id")) || null;
  const name = text(form, "name");
  const address = text(form, "address");
  const sector = text(form, "sector");
  const type = text(form, "type");
  const ping = form.get("ping") !== "false";
  const latencyWarn = parseLimit(text(form, "latencyWarn"), 0.1, LATENCY_MAX_MS);
  const lossWarn = parseLimit(text(form, "lossWarn"), 0, 100);
  const parent = Number(text(form, "parent")) || null;

  if (!name || name.length > 80) return { error: "Inserisci un nome (massimo 80 caratteri)." };
  if (!isValidAddress(address)) return { error: "Indirizzo non valido: usa un IP o un nome host." };
  if (sector.length > 40) return { error: "Il settore può avere al massimo 40 caratteri." };
  if (!isDeviceType(type)) return { error: "Scegli il tipo di dispositivo." };
  if (latencyWarn === undefined) return { error: "Soglia di latenza non valida: indica i millisecondi." };
  if (lossWarn === undefined) return { error: "Soglia di perdita non valida: indica una percentuale da 0 a 100." };
  if (parent !== null && !isRowId(parent)) return { error: "Scegli il dispositivo a cui è collegato." };
  if (parent !== null && id !== null && (await wouldLoop([id], parent))) return { error: LOOP_ERROR };

  const critical = form.get("critical") === "on";
  const publicLabel = text(form, "publicLabel") || null;
  if (publicLabel && publicLabel.length > 80) return { error: "Il nome pubblico può avere al massimo 80 caratteri." };
  const inventory: (string | null)[] = [];
  for (const field of INVENTORY_FIELDS) {
    const value = text(form, field.key);
    if (value.length > field.max) return { error: `${field.label} può avere al massimo ${field.max} caratteri.` };
    inventory.push(value || null);
  }
  const purchasedOn = parseDay(text(form, "purchasedOn"));
  const warrantyUntil = parseDay(text(form, "warrantyUntil"));
  if (purchasedOn === undefined || warrantyUntil === undefined) return { error: "Date non valide: usa il calendario." };

  const fields = [
    ...[name, address, sector, type, ping, latencyWarn, lossWarn, parent],
    ...[critical, publicLabel, ...inventory, purchasedOn, warrantyUntil],
  ];

  try {
    await transaction(async (client) => {
      if (id === null) {
        await client.query(
          `INSERT INTO hosts (name, address, group_name, device_type, ping_enabled, latency_warn_ms, loss_warn_pct, parent_id,
                              critical, public_label, manufacturer, model, serial, firmware, location, owner, inventory_note,
                              purchased_on, warranty_until)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          fields,
        );
        return;
      }
      const previous = await client.query<{ address: string; ping_enabled: boolean }>(
        "SELECT address, ping_enabled FROM hosts WHERE id = $1 FOR UPDATE",
        [id],
      );
      await client.query(
        `UPDATE hosts SET name = $2, address = $3, group_name = $4, device_type = $5,
           ping_enabled = $6, latency_warn_ms = $7, loss_warn_pct = $8, parent_id = $9,
           critical = $10, public_label = $11, manufacturer = $12, model = $13, serial = $14, firmware = $15,
           location = $16, owner = $17, inventory_note = $18, purchased_on = $19,
           -- Con una garanzia nuova l'avviso di scadenza torna a valere
           warranty_alerted_for = CASE WHEN warranty_until IS DISTINCT FROM $20::date THEN NULL ELSE warranty_alerted_for END,
           warranty_until = $20
         WHERE id = $1`,
        [id, ...fields],
      );
      // Con un indirizzo o un metodo nuovo lo stato precedente non vale più
      const before = previous.rows[0];
      if (before && (before.address !== address || before.ping_enabled !== ping)) await resetMonitoring(client, id);
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "Esiste già un host con questo indirizzo." };
    if (isForeignKeyViolation(error)) return { error: "Il dispositivo a cui è collegato non esiste più." };
    throw error;
  }

  await audit(user, id === null ? "host.create" : "host.update", `${name} (${address})`);
  revalidateHosts();
  revalidatePath("/inventario");
  return { ok: true };
}

export async function bulkUpdateHostsAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const ids = form.getAll("id").map(Number).filter(isRowId);
  const sector = text(form, "sector");
  const type = text(form, "type");
  // Vuoto lascia tutto com'è: togliere il collegamento è una scelta a parte
  const link = text(form, "parent");
  const parent = link === "none" ? null : Number(link);

  if (ids.length === 0) return { error: "Seleziona almeno un host." };
  if (!sector && !type && !link) return { error: "Indica il settore, il tipo o il collegamento da assegnare." };
  if (sector.length > 40) return { error: "Il settore può avere al massimo 40 caratteri." };
  if (type && !isDeviceType(type)) return { error: "Tipo di dispositivo non valido." };
  if (link && parent !== null && !isRowId(parent)) return { error: "Scegli il dispositivo a cui collegarli." };
  if (link && parent !== null && (await wouldLoop(ids, parent))) return { error: LOOP_ERROR };

  let updated: number | null;
  try {
    const { rowCount } = await db().query(
      `UPDATE hosts SET group_name = coalesce($2, group_name), device_type = coalesce($3, device_type),
         parent_id = CASE WHEN $4::boolean THEN $5::int ELSE parent_id END
       WHERE id = ANY($1::int[])`,
      [ids, sector || null, type || null, Boolean(link), link ? parent : null],
    );
    updated = rowCount;
  } catch (error) {
    if (isForeignKeyViolation(error)) return { error: "Il dispositivo a cui collegarli non esiste più." };
    throw error;
  }

  await audit(user, "host.bulk", `${updated ?? 0} host`, {
    sector: sector || undefined,
    type: type || undefined,
    parent: link ? parent : undefined,
  });
  revalidateHosts();
  return { ok: true, message: updated === 1 ? "1 host aggiornato." : `${updated} host aggiornati.` };
}

export async function toggleHostAction(form: FormData) {
  const user = await requireAdmin();
  const id = Number(form.get("id"));
  const enabled = form.get("enabled") === "true";
  if (!isRowId(id)) return;

  const name = await transaction(async (client) => {
    const { rows } = await client.query<{ name: string }>("UPDATE hosts SET enabled = $2 WHERE id = $1 RETURNING name", [
      id,
      enabled,
    ]);
    if (rows[0] && !enabled) await resetMonitoring(client, id);
    return rows[0]?.name;
  });
  if (name) await audit(user, enabled ? "host.enable" : "host.disable", name);
  revalidateHosts();
}

export async function deleteHostAction(form: FormData) {
  const user = await requireAdmin();
  const id = Number(form.get("id"));
  if (!isRowId(id)) return;
  const { rows } = await db().query<{ name: string; address: string }>(
    "DELETE FROM hosts WHERE id = $1 RETURNING name, address",
    [id],
  );
  if (rows[0]) await audit(user, "host.delete", `${rows[0].name} (${rows[0].address})`);
  revalidateHosts();
}

// Manutenzioni

const REASON_MAX = 200;

/** Le date arrivano già in ISO: è il browser a sapere in che fuso le ha scritte chi le ha inserite. */
export async function saveMaintenanceAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = Number(form.get("id")) || null;
  const target = text(form, "target");
  const reason = text(form, "reason");
  const starts = new Date(text(form, "starts"));
  const ends = new Date(text(form, "ends"));

  // Il settore può essere vuoto: "s:" sono gli host senza settore
  const sector = target.startsWith("s:") ? target.slice(2) : null;
  const hostId = target.startsWith("h:") ? Number(target.slice(2)) : null;

  if (sector === null && (hostId === null || !isRowId(hostId))) return { error: "Scegli l'host o il settore." };
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return { error: "Indica inizio e fine." };
  if (ends <= starts) return { error: "La fine deve venire dopo l'inizio." };
  if (ends.getTime() <= Date.now()) return { error: "La fine deve essere nel futuro." };
  if (reason.length > REASON_MAX) return { error: `Il motivo può avere al massimo ${REASON_MAX} caratteri.` };

  try {
    if (id === null) {
      // Una finestra non si scrive nel passato: cancellerebbe guasti già avvenuti dalla disponibilità
      await db().query(
        `INSERT INTO maintenance_windows (host_id, sector, starts_at, ends_at, reason, created_by)
         VALUES ($1, $2, greatest($3::timestamptz, now()), $4, $5, $6)`,
        [hostId, sector, starts, ends, reason, user.username],
      );
    } else {
      // Di una finestra già iniziata si cambiano solo la fine e il motivo
      const { rowCount } = await db().query(
        `UPDATE maintenance_windows SET
           host_id = CASE WHEN starts_at <= now() THEN host_id ELSE $2 END,
           sector = CASE WHEN starts_at <= now() THEN sector ELSE $3 END,
           starts_at = CASE WHEN starts_at <= now() THEN starts_at ELSE greatest($4::timestamptz, now()) END,
           ends_at = $5, reason = $6
         WHERE id = $1 AND ends_at > now()`,
        [id, hostId, sector, starts, ends, reason],
      );
      if (!rowCount) return { error: "Questa manutenzione è già finita." };
    }
  } catch (error) {
    if (isForeignKeyViolation(error)) return { error: "Host non trovato." };
    throw error;
  }

  await audit(user, "maintenance.save", sector !== null ? `Settore ${sector || "senza nome"}` : `Host ${hostId}`, {
    starts: starts.toISOString(),
    ends: ends.toISOString(),
    reason: reason || undefined,
  });
  revalidatePath("/admin/manutenzioni");
  return { ok: true };
}

export async function endMaintenanceAction(form: FormData) {
  const user = await requireAdmin();
  const id = Number(form.get("id"));
  if (!isRowId(id)) return;
  const { rowCount } = await db().query(
    "UPDATE maintenance_windows SET ends_at = now() WHERE id = $1 AND starts_at < now() AND ends_at > now()",
    [id],
  );
  if (rowCount) await audit(user, "maintenance.end", `Manutenzione ${id}`);
  revalidatePath("/admin/manutenzioni");
}

/** Una finestra in corso si termina, non si cancella: la sua parte già trascorsa resta valida. */
export async function deleteMaintenanceAction(form: FormData) {
  const user = await requireAdmin();
  const id = Number(form.get("id"));
  if (!isRowId(id)) return;
  const { rowCount } = await db().query(
    "DELETE FROM maintenance_windows WHERE id = $1 AND NOT (starts_at <= now() AND ends_at > now())",
    [id],
  );
  if (rowCount) await audit(user, "maintenance.delete", `Manutenzione ${id}`);
  revalidatePath("/admin/manutenzioni");
}

// Presa in carico

const NOTE_MAX = 500;

export async function saveOutageNoteAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = Number(form.get("id"));
  const note = text(form, "note");
  const takeOver = form.get("takeover") === "on";
  const table = form.get("kind") === "service" ? "service_outages" : "outages";

  if (!isRowId(id)) return { error: "Interruzione non trovata." };
  if (note.length > NOTE_MAX) return { error: `La nota può avere al massimo ${NOTE_MAX} caratteri.` };

  // Scrivere una nota su un guasto di un altro non lo toglie a chi lo sta seguendo.
  // La presa in carico ferma anche l'escalation: il worker sale di livello solo se ack_by è vuoto.
  const { rows } = await db().query<{ ack_by: string }>(
    `UPDATE ${table} SET note = $2,
       ack_at = CASE WHEN ack_by IS NULL OR $3::boolean THEN now() ELSE ack_at END,
       ack_by = CASE WHEN ack_by IS NULL OR $3::boolean THEN $4 ELSE ack_by END
     WHERE id = $1
     RETURNING ack_by`,
    [id, note, takeOver, user.username],
  );
  if (!rows[0]) return { error: "Interruzione non trovata." };
  await audit(
    user,
    rows[0].ack_by === user.username ? "outage.ack" : "outage.note",
    `${table === "outages" ? "Host" : "Servizio"}, interruzione ${id}`,
    note ? { note } : null,
  );
  return { ok: true };
}

// Planimetrie

export async function saveFloorPlanAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = Number(form.get("id")) || null;
  const name = text(form, "name");
  const file = form.get("image");
  const upload = file instanceof File && file.size > 0 ? file : null;

  if (id !== null && !isRowId(id)) return { error: "Planimetria non trovata." };
  if (!name || name.length > 60) return { error: "Inserisci un nome (massimo 60 caratteri)." };
  if (id === null && !upload) return { error: "Scegli l'immagine della pianta." };
  if (upload && upload.size > PLAN_MAX_BYTES) return { error: "Immagine troppo pesante." };

  const image = upload ? Buffer.from(await upload.arrayBuffer()) : null;
  const mime = image ? sniffImage(image) : null;
  if (image && !mime) return { error: "Formato non accettato: usa PNG, JPEG o WebP." };

  try {
    if (id === null) {
      const { rows } = await db().query<{ id: number }>(
        "INSERT INTO floor_plans (name, image, mime) VALUES ($1, $2, $3) RETURNING id",
        [name, image, mime],
      );
      await audit(user, "plan.save", name);
      revalidatePath("/planimetrie");
      return { ok: true, id: rows[0].id };
    }
    const { rowCount } = await db().query(
      `UPDATE floor_plans
       SET name = $2, image = coalesce($3, image), mime = coalesce($4, mime),
           version = version + CASE WHEN $3::bytea IS NULL THEN 0 ELSE 1 END
       WHERE id = $1`,
      [id, name, image, mime],
    );
    if (!rowCount) return { error: "Planimetria non trovata." };
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "Esiste già una planimetria con questo nome." };
    throw error;
  }

  await audit(user, "plan.save", name);
  revalidatePath("/planimetrie");
  return { ok: true, id };
}

export async function deleteFloorPlanAction(form: FormData) {
  const user = await requireAdmin();
  const id = Number(form.get("id"));
  const { rows } = isRowId(id)
    ? await db().query<{ name: string }>("DELETE FROM floor_plans WHERE id = $1 RETURNING name", [id])
    : { rows: [] };
  if (rows[0]) await audit(user, "plan.delete", rows[0].name);
  revalidatePath("/planimetrie");
  redirect("/planimetrie");
}

/** Sostituisce tutte le posizioni. Il JOIN scarta gli host eliminati mentre si modificava. */
export async function savePlanPositionsAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = Number(form.get("id"));
  const positions = parsePositions(String(form.get("positions") ?? ""));

  if (!isRowId(id)) return { error: "Planimetria non trovata." };
  if (!positions) return { error: "Posizioni non valide." };

  try {
    await transaction(async (client) => {
      await client.query("DELETE FROM floor_plan_hosts WHERE plan_id = $1", [id]);
      await client.query(
        `INSERT INTO floor_plan_hosts (plan_id, host_id, x, y)
         SELECT $1, u.id, u.x, u.y
         FROM unnest($2::int[], $3::real[], $4::real[]) AS u(id, x, y)
         JOIN hosts h ON h.id = u.id`,
        [id, positions.map((item) => item.hostId), positions.map((item) => item.x), positions.map((item) => item.y)],
      );
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) return { error: "Planimetria non trovata." };
    throw error;
  }

  await audit(user, "plan.positions", `Planimetria ${id}`, { hosts: positions.length });
  revalidatePath("/planimetrie");
  return { ok: true };
}

export async function startDiscoveryAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const subnet = parseSubnet(text(form, "subnet"), { allowLoopback: process.env.DISCOVERY_ALLOW_LOOPBACK === "1" });
  if (subnet.error !== undefined) return { error: subnet.error };

  try {
    await db().query("INSERT INTO discovery_scans (subnet, created_by) VALUES ($1, $2)", [subnet.cidr, user.username]);
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "C'è già una ricerca in corso: aspetta che finisca o annullala." };
    throw error;
  }
  await audit(user, "discovery.start", subnet.cidr);
  return { ok: true };
}

export async function cancelDiscoveryAction(form: FormData) {
  const user = await requireAdmin();
  const id = Number(form.get("id"));
  if (!isRowId(id)) return;
  const { rows } = await db().query<{ subnet: string }>(
    `UPDATE discovery_scans SET status = 'failed', error = $2, finished_at = now()
     WHERE id = $1 AND status IN ('queued', 'running')
     RETURNING subnet::text`,
    [id, `Annullata da ${user.username}.`],
  );
  if (rows[0]) await audit(user, "discovery.cancel", rows[0].subnet);
}

/**
 * Si aggiunge solo ciò che la ricerca ha trovato, con i dati letti dal database e non dal modulo.
 * Un dispositivo che non risponde al ping risulterebbe subito offline: si tiene d'occhio una sua porta.
 */
export async function addDiscoveredHostsAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const scanId = Number(form.get("scan"));
  const sector = text(form, "sector");
  const chosen = [...new Set(form.getAll("address").map(String))];

  if (!isRowId(scanId)) return { error: "Ricerca non trovata." };
  if (chosen.length === 0) return { error: "Seleziona almeno un dispositivo." };
  if (sector.length > 40) return { error: "Il settore può avere al massimo 40 caratteri." };

  const { rows } = await db().query<{ found: { address: string; rtt: number | null; ports: number[] }[] }>(
    "SELECT found FROM discovery_scans WHERE id = $1",
    [scanId],
  );
  const found = new Map((rows[0]?.found ?? []).map((item) => [item.address, item]));

  const entries: { address: string; name: string; type: DeviceType; ping: boolean; port?: number }[] = [];
  for (const address of chosen) {
    const item = found.get(address);
    if (!item) return { error: `${address} non fa parte di questa ricerca.` };
    const name = text(form, `name:${address}`) || address;
    const type = text(form, `type:${address}`);
    if (name.length > 80) return { error: `Il nome di ${address} supera gli 80 caratteri.` };
    if (!isDeviceType(type)) return { error: `Scegli il tipo di ${address}.` };
    entries.push({ address, name, type, ping: item.rtt !== null, port: item.rtt === null ? item.ports[0] : undefined });
  }

  const added = await transaction(async (client) => {
    let count = 0;
    for (const entry of entries) {
      const { rows: inserted } = await client.query<{ id: number }>(
        `INSERT INTO hosts (name, address, group_name, device_type, ping_enabled) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (address) DO NOTHING RETURNING id`,
        [entry.name, entry.address, sector, entry.type, entry.ping],
      );
      if (inserted.length === 0) continue;
      count++;
      if (entry.port !== undefined) {
        await client.query("INSERT INTO service_checks (host_id, name, kind, port) VALUES ($1, $2, 'tcp', $3)", [
          inserted[0].id,
          `Porta ${entry.port}`,
          entry.port,
        ]);
      }
    }
    return count;
  });

  if (added > 0) await audit(user, "discovery.add", `${added} host`);
  revalidateHosts();
  const skipped = entries.length - added;
  const summary = added === 1 ? "Aggiunto 1 host." : `Aggiunti ${added} host.`;
  return { ok: true, message: skipped > 0 ? `${summary} Già presenti: ${skipped}.` : summary };
}

export async function saveTypeThresholdsAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();

  const rows: { type: DeviceType; latency: number | null; loss: number | null }[] = [];
  for (const { key, label } of DEVICE_TYPES) {
    const latency = parseLimit(text(form, `latency-${key}`), 0.1, LATENCY_MAX_MS);
    const loss = parseLimit(text(form, `loss-${key}`), 0, 100);
    if (latency === undefined) return { error: `${label}: soglia di latenza non valida.` };
    if (loss === undefined) return { error: `${label}: la perdita va da 0 a 100.` };
    rows.push({ type: key, latency, loss });
  }

  await db().query(
    `INSERT INTO type_thresholds (device_type, latency_warn_ms, loss_warn_pct)
     SELECT * FROM unnest($1::text[], $2::real[], $3::real[])
     ON CONFLICT (device_type) DO UPDATE SET
       latency_warn_ms = EXCLUDED.latency_warn_ms, loss_warn_pct = EXCLUDED.loss_warn_pct`,
    [rows.map((row) => row.type), rows.map((row) => row.latency), rows.map((row) => row.loss)],
  );

  await audit(user, "types.thresholds");
  revalidatePath("/admin/host");
  return { ok: true };
}

// Controlli sui servizi

export async function saveServiceAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const id = Number(form.get("id")) || null;
  const hostId = Number(form.get("hostId"));
  const name = text(form, "name");
  const kind = text(form, "kind");
  const portText = text(form, "port");
  const urlText = text(form, "url");
  const warnDays = kind === "cert" ? parseLimit(text(form, "warnDays"), 1, 365) : null;

  if (!isRowId(hostId)) return { error: "Scegli l'host." };
  if (!name || name.length > 60) return { error: "Inserisci un nome (massimo 60 caratteri)." };
  if (kind !== "tcp" && kind !== "http" && kind !== "cert") return { error: "Scegli il tipo di controllo." };
  if (warnDays === undefined || (warnDays !== null && !Number.isInteger(warnDays))) {
    return { error: "I giorni di preavviso vanno da 1 a 365." };
  }

  const port = kind === "tcp" ? Number(portText) : null;
  const url = kind === "tcp" ? null : urlText;
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    return { error: "La porta va da 1 a 65535." };
  }
  if (url !== null && !isValidCheckUrl(url)) {
    return { error: "Indirizzo non valido: usa http:// o https://, senza nome utente e password." };
  }

  try {
    const found = await transaction(async (client) => {
      if (id === null) {
        await client.query(
          "INSERT INTO service_checks (host_id, name, kind, port, url, warn_days) VALUES ($1, $2, $3, $4, $5, $6)",
          [hostId, name, kind, port, url, warnDays ?? 30],
        );
        return true;
      }

      const { rows } = await client.query<{ host_id: number; kind: string; port: number | null; url: string | null }>(
        "SELECT host_id, kind, port, url FROM service_checks WHERE id = $1 FOR UPDATE",
        [id],
      );
      const before = rows[0];
      if (!before) return false;

      await client.query(
        "UPDATE service_checks SET host_id = $2, name = $3, kind = $4, port = $5, url = $6, warn_days = $7 WHERE id = $1",
        [id, hostId, name, kind, port, url, warnDays ?? 30],
      );
      // Cambiando cosa si controlla, lo stato precedente non vale più
      if (before.host_id !== hostId || before.kind !== kind || before.port !== port || before.url !== url) {
        await client.query("UPDATE service_outages SET ended_at = now() WHERE check_id = $1 AND ended_at IS NULL", [id]);
        await client.query(`UPDATE service_checks SET ${CHECK_RESET} WHERE id = $1`, [id]);
      }
      return true;
    });
    if (!found) return { error: "Controllo non trovato." };
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "Questo host ha già un controllo con questo nome." };
    if (isForeignKeyViolation(error)) return { error: "Host non trovato." };
    throw error;
  }

  await audit(user, "service.save", name, { kind, port: port ?? undefined, url: url ?? undefined });
  revalidatePath("/servizi");
  return { ok: true };
}

export async function deleteServiceAction(form: FormData) {
  const user = await requireAdmin();
  const id = Number(form.get("id"));
  const { rows } = isRowId(id)
    ? await db().query<{ name: string }>("DELETE FROM service_checks WHERE id = $1 RETURNING name", [id])
    : { rows: [] };
  if (rows[0]) await audit(user, "service.delete", rows[0].name);
  revalidatePath("/servizi");
}

// PC collegati agli avvisi. Ognuno gestisce i propri.

export async function createAlertDeviceAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = text(form, "name");
  if (!name || name.length > 60) return { error: "Dai un nome al PC (massimo 60 caratteri)." };

  const { token, hash } = newDeviceToken();
  await db().query("INSERT INTO alert_devices (user_id, name, token_hash) VALUES ($1, $2, $3)", [user.id, name, hash]);
  await audit(user, "device.create", name);
  revalidatePath("/account");
  return { ok: true, token };
}

export async function deleteAlertDeviceAction(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  const { rows } = isRowId(id)
    ? await db().query<{ name: string }>("DELETE FROM alert_devices WHERE id = $1 AND user_id = $2 RETURNING name", [
        id,
        user.id,
      ])
    : { rows: [] };
  if (rows[0]) await audit(user, "device.delete", rows[0].name);
  revalidatePath("/account");
}

// Profili. Quelli condivisi li gestisce un admin, quelli personali solo il proprietario.

const CAN_EDIT_PROFILE = "(owner_id = $2 OR ($3::boolean AND owner_id IS NULL))";

function revalidateProfiles() {
  revalidatePath("/", "layout");
}

export async function saveProfileAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const id = Number(form.get("id")) || null;
  const name = text(form, "name");
  const shared = form.get("shared") === "true";
  const sectors = [...new Set(form.getAll("sector").map((value) => String(value).trim()))];
  const types = [...new Set(form.getAll("type"))].filter(isDeviceType);
  const hostIds = [...new Set(form.getAll("host").map(Number))].filter(isRowId);
  const panels = [...new Set(form.getAll("panel"))].filter(isPanel);
  const view = form.get("view");
  const groupBy = form.get("groupBy");

  if (!name || name.length > 60) return { error: "Inserisci un nome (massimo 60 caratteri)." };
  if (shared && !isAdmin) return { error: "Solo un amministratore può condividere una vista." };
  if (sectors.length > 200 || sectors.some((sector) => sector.length > 40)) return { error: "Settori non validi." };
  if (hostIds.length > 2000) return { error: "Troppi host scelti a mano." };
  if (!isViewMode(view) || !isGroupBy(groupBy)) return { error: "Vista non valida." };
  if (panels.length === 0) return { error: "Scegli almeno un pannello da mostrare." };

  const owner = shared ? null : user.id;
  const values = [sectors, types, hostIds, view, groupBy, parseRange(form.get("range")), panels];

  try {
    if (id === null) {
      const { rows } = await db().query<{ id: number }>(
        `INSERT INTO profiles (name, owner_id, sectors, device_types, host_ids, view_mode, group_by, range_key, panels)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [name, owner, ...values],
      );
      await audit(user, "profile.save", name);
      revalidateProfiles();
      return { ok: true, id: rows[0].id };
    }

    const { rowCount } = await db().query(
      `UPDATE profiles
       SET name = $4, owner_id = $5, sectors = $6, device_types = $7, host_ids = $8,
           view_mode = $9, group_by = $10, range_key = $11, panels = $12
       WHERE id = $1 AND ${CAN_EDIT_PROFILE}`,
      [id, user.id, isAdmin, name, owner, ...values],
    );
    if (!rowCount) return { error: "Non puoi modificare questa vista." };
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "Esiste già una vista con questo nome." };
    throw error;
  }

  await audit(user, "profile.save", name);
  revalidateProfiles();
  return { ok: true, id };
}

export async function deleteProfileAction(form: FormData) {
  const user = await requireUser();
  const { rows } = await db().query<{ name: string }>(
    `DELETE FROM profiles WHERE id = $1 AND ${CAN_EDIT_PROFILE} RETURNING name`,
    [Number(form.get("id")) || 0, user.id, user.role === "admin"],
  );
  if (rows[0]) await audit(user, "profile.delete", rows[0].name);
  revalidateProfiles();
}

// Utenti

export async function saveUserAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = Number(form.get("id")) || null;
  const username = text(form, "username");
  const role = text(form, "role");
  const password = String(form.get("password") ?? "");
  // Un amministratore vede sempre tutto
  const restricted = role === "viewer" && form.get("access") === "limited";
  const sectors = restricted ? [...new Set(form.getAll("sector").map((value) => String(value).trim()))] : [];
  const hostIds = restricted ? [...new Set(form.getAll("host").map(Number))].filter(isRowId) : [];
  const alertTier = Number(form.get("alertTier") ?? 1);

  if (role !== "admin" && role !== "viewer") return { error: "Ruolo non valido." };
  if (![1, 2, 3].includes(alertTier)) return { error: "Livello degli avvisi non valido." };
  if (id === null || password) {
    if (!isValidPassword(password)) return { error: "La password deve avere da 8 a 128 caratteri." };
  }
  if (!isValidUsername(username)) {
    return { error: "Nome utente: 3-32 caratteri tra lettere, numeri, punto, trattino e underscore." };
  }
  if (id === admin.id && role !== "admin") {
    return { error: "Non puoi togliere a te stesso il ruolo di amministratore." };
  }
  if (sectors.length > 200 || sectors.some((sector) => sector.length > 40)) return { error: "Settori non validi." };
  if (hostIds.length > 2000) return { error: "Troppi dispositivi scelti." };

  const passwordHash = password ? await hashPassword(password) : null;

  try {
    const failure = await transaction(async (client) => {
      if (id === null) {
        await client.query(
          `INSERT INTO users (username, password_hash, role, restricted, sectors, host_ids, alert_tier)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [username, passwordHash, role, restricted, sectors, hostIds, alertTier],
        );
        return null;
      }

      // Il lock sugli admin rende sicuro il controllo anche con due modifiche simultanee
      const { rows: admins } = await client.query<{ id: number }>(
        "SELECT id FROM users WHERE role = 'admin' FOR UPDATE",
      );
      if (role !== "admin" && admins.length === 1 && admins[0].id === id) {
        return "Deve restare almeno un amministratore.";
      }

      await client.query(
        `UPDATE users SET username = $2, role = $3, password_hash = coalesce($4, password_hash), restricted = $5,
                          sectors = $6, host_ids = $7, alert_tier = $8
         WHERE id = $1`,
        [id, username, role, passwordHash, restricted, sectors, hostIds, alertTier],
      );
      if (passwordHash) await client.query("DELETE FROM sessions WHERE user_id = $1", [id]);
      return null;
    });
    if (failure) return { error: failure };
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "Questo nome utente esiste già." };
    throw error;
  }

  await audit(admin, id === null ? "user.create" : "user.update", username, {
    role,
    restricted,
    alertTier,
    password: passwordHash && id !== null ? "cambiata" : undefined,
  });
  revalidatePath("/admin/utenti");
  return { ok: true };
}

export async function deleteUserAction(form: FormData) {
  const admin = await requireAdmin();
  const id = Number(form.get("id"));
  if (id === admin.id || !isRowId(id)) return;

  const removed = await transaction(async (client) => {
    const { rows: admins } = await client.query<{ id: number }>(
      "SELECT id FROM users WHERE role = 'admin' FOR UPDATE",
    );
    if (admins.length === 1 && admins[0].id === id) return null;
    const { rows } = await client.query<{ username: string }>("DELETE FROM users WHERE id = $1 RETURNING username", [id]);
    return rows[0]?.username ?? null;
  });
  if (removed) await audit(admin, "user.delete", removed);
  revalidatePath("/admin/utenti");
}
