import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { SessionUser } from "./auth";
import { db } from "./db";

export type ApiScope = "read" | "write";

export interface ApiKey {
  id: number;
  name: string;
  scope: ApiScope;
}

const PREFIX = "vgk_";
const hashKey = (token: string) => createHash("sha256").update(token).digest();

/** La chiave vera si mostra una volta sola: nel database restano l'hash e i primi caratteri. */
export function newApiKey() {
  const token = `${PREFIX}${randomBytes(30).toString("base64url")}`;
  return { token, hash: hashKey(token), prefix: token.slice(0, PREFIX.length + 6) };
}

/** La chiave dall'intestazione `Authorization: Bearer vgk_…`, se valida e non scaduta. */
export async function apiKeyFromRequest(request: Request): Promise<ApiKey | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(vgk_[A-Za-z0-9_-]{20,80})$/.exec(header.trim());
  if (!match) return null;

  const { rows } = await db().query<ApiKey>(
    `SELECT id, name, scope FROM api_keys
     WHERE token_hash = $1 AND (expires_at IS NULL OR expires_at > now())`,
    [hashKey(match[1])],
  );
  const key = rows[0];
  if (!key) return null;

  await db().query(
    "UPDATE api_keys SET last_used = now() WHERE id = $1 AND (last_used IS NULL OR last_used < now() - interval '1 minute')",
    [key.id],
  );
  return key;
}

/** Le query di lettura lavorano per utente: una chiave vede tutto, come un amministratore. */
export const keyUser = (key: ApiKey): SessionUser => ({
  id: 0,
  username: `api:${key.name}`,
  role: "admin",
  restricted: false,
  alertTier: 1,
});

export const apiError = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export const apiJson = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Controlla la chiave e il permesso, poi esegue. Gli errori imprevisti restano nel log:
 * a chi chiama arriva solo un messaggio generico.
 */
export async function withApiKey(
  request: Request,
  scope: ApiScope,
  handler: (key: ApiKey) => Promise<Response>,
): Promise<Response> {
  const key = await apiKeyFromRequest(request);
  if (!key) return apiError(401, "Chiave API mancante, non valida o scaduta.");
  if (scope === "write" && key.scope !== "write") return apiError(403, "Questa chiave è in sola lettura.");
  try {
    return await handler(key);
  } catch (error) {
    console.error("API v1:", error);
    return apiError(500, "Errore interno.");
  }
}

/** Il corpo JSON di una richiesta, oppure null se manca o non è un oggetto. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
