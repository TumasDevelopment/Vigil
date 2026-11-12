import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { apiError, apiJson, keyUser, readJson, withApiKey } from "@/lib/apikeys";
import { field, flagField, hostView, numberField, rowId } from "@/lib/api-v1";
import { db } from "@/lib/db";
import { isForeignKeyViolation, isUniqueViolation } from "@/lib/form";
import { getHostSummaries } from "@/lib/queries";
import { parseDeviceType } from "@/lib/scope";
import { isValidAddress } from "@/lib/validate";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return withApiKey(request, "read", async (key) => {
    const hosts = await getHostSummaries(keyUser(key));
    return apiJson({ hosts: hosts.map(hostView) });
  });
}

/** Crea un host: { name, address, sector?, type?, ping?, critical?, publicLabel?, parentId?, latencyWarnMs?, lossWarnPct? } */
export function POST(request: Request) {
  return withApiKey(request, "write", async (key) => {
    const body = await readJson(request);
    if (!body) return apiError(400, "Serve un oggetto JSON.");

    const name = field(body, "name");
    const address = field(body, "address");
    const sector = field(body, "sector");
    const typeText = field(body, "type");
    const publicLabel = field(body, "publicLabel");
    const ping = flagField(body, "ping");
    const critical = flagField(body, "critical");
    const latencyWarn = numberField(body, "latencyWarnMs", 0.1, 60_000);
    const lossWarn = numberField(body, "lossWarnPct", 0, 100);
    const hasParent = body.parentId !== undefined && body.parentId !== null;
    const parentId = hasParent ? rowId(body.parentId) : null;
    const type = typeText ? parseDeviceType(typeText) : "altro";

    if (!name || name.length > 80) return apiError(400, "name: obbligatorio, al massimo 80 caratteri.");
    if (address === undefined || !isValidAddress(address)) return apiError(400, "address: IP o nome host non valido.");
    if (sector === undefined || sector.length > 40) return apiError(400, "sector: al massimo 40 caratteri.");
    if (!type) return apiError(400, "type: tipo di dispositivo sconosciuto.");
    if (publicLabel === undefined || publicLabel.length > 80) return apiError(400, "publicLabel: al massimo 80 caratteri.");
    if (ping === undefined || critical === undefined) return apiError(400, "ping e critical devono essere true o false.");
    if (latencyWarn === undefined) return apiError(400, "latencyWarnMs: millisecondi da 0,1 a 60000.");
    if (lossWarn === undefined) return apiError(400, "lossWarnPct: percentuale da 0 a 100.");
    if (hasParent && parentId === null) return apiError(400, "parentId: id di un host esistente.");

    let id: number;
    try {
      const { rows } = await db().query<{ id: number }>(
        `INSERT INTO hosts (name, address, group_name, device_type, ping_enabled, latency_warn_ms, loss_warn_pct,
                            parent_id, critical, public_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [name, address, sector, type, ping ?? true, latencyWarn, lossWarn, parentId, critical ?? false, publicLabel || null],
      );
      id = rows[0].id;
    } catch (error) {
      if (isUniqueViolation(error)) return apiError(409, "Esiste già un host con questo indirizzo.");
      if (isForeignKeyViolation(error)) return apiError(400, "parentId: host non trovato.");
      throw error;
    }

    await audit({ id: 0, username: `api:${key.name}` }, "host.create", `${name} (${address})`);
    revalidatePath("/admin/host");
    revalidatePath("/");
    return apiJson({ id }, 201);
  });
}
