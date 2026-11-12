"use server";
// Accesso con due fattori e chiavi API.
import { revalidatePath } from "next/cache";
import type { FormState } from "./actions";
import { newApiKey } from "./apikeys";
import { audit } from "./audit";
import { requireAdmin, requireUser } from "./auth";
import { db } from "./db";
import { isRowId, text } from "./form";
import { verifyPassword } from "./password.mjs";
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from "./totp.mjs";

/**
 * Primo passo dell'attivazione: un segreto nuovo, non ancora valido per l'accesso.
 * Diventa attivo solo quando la persona dimostra di averlo nell'app con un codice giusto.
 */
export async function startTotpAction(): Promise<FormState> {
  const user = await requireUser();
  const secret = newTotpSecret();
  const { rowCount } = await db().query(
    "UPDATE users SET totp_secret = $2, totp_last_step = NULL WHERE id = $1 AND NOT totp_enabled",
    [user.id, secret],
  );
  if (!rowCount) return { error: "I due fattori sono già attivi." };
  return { ok: true, data: { secret, uri: otpauthUri({ issuer: "Vigil", account: user.username, secret }) } };
}

export async function confirmTotpAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const code = text(form, "code");
  const { rows } = await db().query<{ totp_secret: string | null }>(
    "SELECT totp_secret FROM users WHERE id = $1 AND NOT totp_enabled",
    [user.id],
  );
  const secret = rows[0]?.totp_secret;
  if (!secret) return { error: "Riparti dall'inizio: il segreto non è più valido." };

  const step = verifyTotp(secret, code, Date.now() / 1000, null);
  if (step === null) return { error: "Codice non corretto: controlla che l'ora del telefono sia giusta." };

  // I codici di recupero si vedono adesso e mai più: nel database resta solo l'hash
  const codes: string[] = newRecoveryCodes(8);
  const { rowCount } = await db().query(
    `UPDATE users SET totp_enabled = true, totp_last_step = $3, recovery_codes = $4
     WHERE id = $1 AND totp_secret = $2 AND NOT totp_enabled`,
    [user.id, secret, step, codes.map(hashRecoveryCode)],
  );
  if (!rowCount) return { error: "Riparti dall'inizio: il segreto è cambiato." };

  await audit(user, "2fa.enable");
  revalidatePath("/account");
  return { ok: true, data: { codes } };
}

export async function disableTotpAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const password = String(form.get("password") ?? "");
  const { rows } = await db().query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [
    user.id,
  ]);
  if (!rows[0] || !password || !(await verifyPassword(password.slice(0, 128), rows[0].password_hash))) {
    return { error: "Password non corretta." };
  }
  await db().query(
    `UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_last_step = NULL, recovery_codes = '{}'
     WHERE id = $1`,
    [user.id],
  );
  await audit(user, "2fa.disable");
  revalidatePath("/account");
  return { ok: true, message: "Due fattori disattivati." };
}

/** Per chi ha perso il telefono e i codici: l'amministratore azzera, la persona riattiva. */
export async function resetUserTotpAction(form: FormData) {
  const admin = await requireAdmin();
  const id = Number(form.get("id"));
  if (!isRowId(id) || id === admin.id) return;
  const { rows } = await db().query<{ username: string }>(
    `UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_last_step = NULL, recovery_codes = '{}'
     WHERE id = $1 AND (totp_enabled OR totp_secret IS NOT NULL)
     RETURNING username`,
    [id],
  );
  if (rows[0]) await audit(admin, "2fa.reset", rows[0].username);
  revalidatePath("/admin/utenti");
}

// Chiavi API

const KEY_DAYS = new Set([0, 30, 90, 365]);

export async function createApiKeyAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const name = text(form, "name");
  const scope = text(form, "scope");
  const days = Number(text(form, "days") || 0);

  if (!name || name.length > 80) return { error: "Dai un nome alla chiave (massimo 80 caratteri)." };
  if (scope !== "read" && scope !== "write") return { error: "Scegli il permesso." };
  if (!KEY_DAYS.has(days)) return { error: "Scegli la durata." };

  const { count } = (await db().query<{ count: number }>("SELECT count(*)::int AS count FROM api_keys")).rows[0];
  if (count >= 50) return { error: "Ci sono già 50 chiavi: revocane qualcuna prima di crearne altre." };

  const key = newApiKey();
  await db().query(
    `INSERT INTO api_keys (name, token_hash, prefix, scope, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::int > 0 THEN now() + make_interval(days => $6::int) END)`,
    [name, key.hash, key.prefix, scope, admin.id, days],
  );
  await audit(admin, "apikey.create", name, { scope, days: days || "senza scadenza" });
  revalidatePath("/admin/api");
  return { ok: true, token: key.token };
}

export async function deleteApiKeyAction(form: FormData) {
  const admin = await requireAdmin();
  const id = Number(form.get("id"));
  if (!isRowId(id)) return;
  const { rows } = await db().query<{ name: string }>("DELETE FROM api_keys WHERE id = $1 RETURNING name", [id]);
  if (rows[0]) await audit(admin, "apikey.delete", rows[0].name);
  revalidatePath("/admin/api");
}
