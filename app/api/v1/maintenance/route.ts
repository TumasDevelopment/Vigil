import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { apiError, apiJson, readJson, withApiKey } from "@/lib/apikeys";
import { field, iso, rowId } from "@/lib/api-v1";
import { db } from "@/lib/db";
import { isForeignKeyViolation } from "@/lib/form";
import { listMaintenance } from "@/lib/queries";

export const dynamic = "force-dynamic";

const REASON_MAX = 200;
const MAX_DAYS = 90;

export function GET(request: Request) {
  return withApiKey(request, "read", async () => {
    const windows = await listMaintenance();
    return apiJson({
      maintenance: windows.map((window) => ({
        id: window.id,
        hostId: window.hostId,
        hostName: window.hostName,
        sector: window.sector,
        starts: iso(window.starts),
        ends: iso(window.ends),
        reason: window.reason,
        createdBy: window.createdBy,
        covered: window.covered,
        state: window.state,
      })),
    });
  });
}

/**
 * Programma una manutenzione: { hostId } oppure { sector } ("" per gli host senza settore),
 * più { ends, starts?, reason? } con date ISO. Senza starts inizia subito; mai nel passato.
 */
export function POST(request: Request) {
  return withApiKey(request, "write", async (key) => {
    const body = await readJson(request);
    if (!body) return apiError(400, "Serve un oggetto JSON.");

    const hasHost = body.hostId !== undefined && body.hostId !== null;
    const hostId = hasHost ? rowId(body.hostId) : null;
    const sector = hasHost ? null : field(body, "sector");
    const reason = field(body, "reason");
    const starts = body.starts ? new Date(String(body.starts)) : new Date();
    const ends = new Date(String(body.ends ?? ""));

    if (hasHost && hostId === null) return apiError(400, "hostId: id di un host.");
    if (hasHost && body.sector !== undefined) return apiError(400, "Indica hostId oppure sector, non entrambi.");
    if (!hasHost && (sector === undefined || body.sector === undefined)) {
      return apiError(400, "Indica hostId oppure sector (testo, anche vuoto).");
    }
    if (sector && sector.length > 40) return apiError(400, "sector: al massimo 40 caratteri.");
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return apiError(400, "starts e ends: date ISO.");
    if (ends <= starts) return apiError(400, "ends deve venire dopo starts.");
    if (ends.getTime() <= Date.now()) return apiError(400, "ends deve essere nel futuro.");
    if (ends.getTime() - Math.max(starts.getTime(), Date.now()) > MAX_DAYS * 86_400_000) {
      return apiError(400, `Una manutenzione dura al massimo ${MAX_DAYS} giorni.`);
    }
    if (reason === undefined || reason.length > REASON_MAX) return apiError(400, `reason: al massimo ${REASON_MAX} caratteri.`);

    const actor = { id: 0, username: `api:${key.name}` };
    let id: number;
    try {
      const { rows } = await db().query<{ id: number }>(
        `INSERT INTO maintenance_windows (host_id, sector, starts_at, ends_at, reason, created_by)
         VALUES ($1, $2, greatest($3::timestamptz, now()), $4, $5, $6) RETURNING id`,
        [hostId, sector, starts, ends, reason, actor.username],
      );
      id = rows[0].id;
    } catch (error) {
      if (isForeignKeyViolation(error)) return apiError(404, "Host non trovato.");
      throw error;
    }

    await audit(actor, "maintenance.save", sector !== null ? `Settore ${sector || "senza nome"}` : `Host ${hostId}`, {
      starts: starts.toISOString(),
      ends: ends.toISOString(),
      reason: reason || undefined,
    });
    revalidatePath("/admin/manutenzioni");
    return apiJson({ id }, 201);
  });
}
