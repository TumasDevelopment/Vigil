import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";

const COOKIE_NAME = "vigil_sessione";
const SESSION_HOURS = 12;
const IDLE_MINUTES = 60;

export type Role = "admin" | "viewer";
export interface SessionUser {
  id: number;
  username: string;
  role: Role;
  /** Vede solo i dispositivi scelti nel suo account. Vale solo per i visualizzatori. */
  restricted: boolean;
  /** Riceve gli avvisi da questo livello di escalation in su (1 = subito). */
  alertTier: number;
  /** Solo per le sessioni del browser. */
  kiosk?: boolean;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest();

async function writeCookie(token: string, expires: Date) {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  await db().query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [
    hashToken(token),
    userId,
    expires,
  ]);
  await writeCookie(token, expires);
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) await db().query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
  store.delete(COOKIE_NAME);
}

export const getUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  const { rows } = await db().query<SessionUser>(
    `SELECT u.id, u.username, u.role, u.restricted, u.alert_tier AS "alertTier", s.kiosk
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()
       AND (s.kiosk OR s.last_active > now() - interval '${IDLE_MINUTES} minutes')`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
});

/** Segna che la persona è presente e, se indicato, attiva o disattiva il chiosco di questa sessione. */
export async function touchSession(kiosk: boolean | null) {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return;
  await db().query("UPDATE sessions SET last_active = now(), kiosk = coalesce($2, kiosk) WHERE token_hash = $1", [
    hashToken(token),
    kiosk,
  ]);
}

/** Il token vero si mostra una volta sola: nel database resta l'hash. */
export function newDeviceToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

/** Per i PC che leggono gli avvisi: agiscono con i permessi dell'utente che li ha collegati. */
export async function deviceUser(token: string): Promise<SessionUser | null> {
  const { rows } = await db().query<SessionUser & { device_id: number }>(
    `SELECT u.id, u.username, u.role, u.restricted, u.alert_tier AS "alertTier", d.id AS device_id
     FROM alert_devices d JOIN users u ON u.id = d.user_id
     WHERE d.token_hash = $1`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;

  await db().query(
    "UPDATE alert_devices SET last_seen = now() WHERE id = $1 AND (last_seen IS NULL OR last_seen < now() - interval '1 minute')",
    [row.device_id],
  );
  return { id: row.id, username: row.username, role: row.role, restricted: row.restricted, alertTier: row.alertTier };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

/**
 * Per le API lette dalla pagina ogni 10 secondi. Allungano la scadenza del cookie ma non
 * contano come attività: senza chiosco, una dashboard lasciata aperta si chiude dopo 1 ora.
 */
export async function apiUser(): Promise<SessionUser | null> {
  const user = await getUser();
  if (!user) return null;

  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (token) {
    const expires = new Date(Date.now() + SESSION_HOURS * 3_600_000);
    const { rowCount } = await db().query(
      `UPDATE sessions SET expires_at = $2
       WHERE token_hash = $1 AND expires_at < now() + interval '${SESSION_HOURS / 2} hours'`,
      [hashToken(token), expires],
    );
    if (rowCount) await writeCookie(token, expires);
  }
  return user;
}

// Secondo passo dell'accesso: tra la password giusta e il codice passano al massimo 5 minuti e 5 tentativi.

const CHALLENGE_COOKIE = "vigil_2fa";
const CHALLENGE_SECONDS = 300;
const CHALLENGE_ATTEMPTS = 5;

export async function createLoginChallenge(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + CHALLENGE_SECONDS * 1000);
  await db().query("DELETE FROM login_challenges WHERE user_id = $1 OR expires_at < now()", [userId]);
  await db().query("INSERT INTO login_challenges (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [
    hashToken(token),
    userId,
    expires,
  ]);
  (await cookies()).set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires,
  });
}

/** C'è un secondo passo ancora valido? Serve alla pagina di accesso dopo un ricaricamento. */
export async function hasLoginChallenge() {
  const token = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  if (!token) return false;
  const { rowCount } = await db().query(
    "SELECT 1 FROM login_challenges WHERE token_hash = $1 AND expires_at > now() AND attempts < $2",
    [hashToken(token), CHALLENGE_ATTEMPTS],
  );
  return (rowCount ?? 0) > 0;
}

/** Conta un tentativo e restituisce l'utente, oppure null se il passo è scaduto o i tentativi sono finiti. */
export async function spendChallengeAttempt(): Promise<number | null> {
  const token = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  if (!token) return null;
  const { rows } = await db().query<{ user_id: number }>(
    `UPDATE login_challenges SET attempts = attempts + 1
     WHERE token_hash = $1 AND expires_at > now() AND attempts < $2
     RETURNING user_id`,
    [hashToken(token), CHALLENGE_ATTEMPTS],
  );
  return rows[0]?.user_id ?? null;
}

export async function clearLoginChallenge() {
  const store = await cookies();
  const token = store.get(CHALLENGE_COOKIE)?.value;
  if (token) await db().query("DELETE FROM login_challenges WHERE token_hash = $1", [hashToken(token)]);
  store.delete(CHALLENGE_COOKIE);
}
