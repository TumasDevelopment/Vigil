import { audit } from "@/lib/audit";
import { apiError, apiJson, readJson, withApiKey } from "@/lib/apikeys";
import { field, iso, rowId } from "@/lib/api-v1";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const NOTE_MAX = 500;

/**
 * Presa in carico: { kind?: "host" | "service", note?: string }. Ferma l'escalation come dalla pagina.
 * Un guasto già preso in carico resta di chi lo segue; la nota, se c'è, si aggiorna comunque.
 */
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiKey(request, "write", async (key) => {
    const id = rowId((await params).id);
    const body = (await readJson(request)) ?? {};
    const note = field(body, "note");
    const kind = body.kind ?? "host";

    if (id === null) return apiError(404, "Interruzione non trovata.");
    if (kind !== "host" && kind !== "service") return apiError(400, "kind: host oppure service.");
    if (note === undefined || note.length > NOTE_MAX) return apiError(400, `note: al massimo ${NOTE_MAX} caratteri.`);

    const table = kind === "service" ? "service_outages" : "outages";
    const actor = { id: 0, username: `api:${key.name}` };
    const { rows } = await db().query<{ ack_by: string; ack_at: number }>(
      `UPDATE ${table} SET note = CASE WHEN $2 = '' THEN note ELSE $2 END,
         ack_at = CASE WHEN ack_by IS NULL THEN now() ELSE ack_at END,
         ack_by = coalesce(ack_by, $3)
       WHERE id = $1
       RETURNING ack_by, extract(epoch FROM ack_at)::float8 AS ack_at`,
      [id, note, actor.username],
    );
    if (!rows[0]) return apiError(404, "Interruzione non trovata.");

    await audit(
      actor,
      rows[0].ack_by === actor.username ? "outage.ack" : "outage.note",
      `${kind === "host" ? "Host" : "Servizio"}, interruzione ${id}`,
      note ? { note } : null,
    );
    return apiJson({ id, kind, ackBy: rows[0].ack_by, ackAt: iso(rows[0].ack_at) });
  });
}
