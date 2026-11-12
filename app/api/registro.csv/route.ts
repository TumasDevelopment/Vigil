import { NextResponse, type NextRequest } from "next/server";
import { AUDIT_LABELS, audit } from "@/lib/audit";
import { apiUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv.mjs";
import { listAudit } from "@/lib/queries-enterprise";

export const dynamic = "force-dynamic";

const MAX_ROWS = 10_000;

/** Il registro con gli stessi filtri della pagina, fino a 10.000 righe. */
export async function GET(request: NextRequest) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Sessione scaduta" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Riservato agli amministratori" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const filter = {
    user: params.get("utente")?.slice(0, 80) || undefined,
    action: params.get("azione")?.slice(0, 60) || undefined,
    q: params.get("q")?.slice(0, 100) || undefined,
  };
  const { rows } = await listAudit({ ...filter, limit: MAX_ROWS });

  const csv = toCsv([
    ["Data e ora (UTC)", "Utente", "Azione", "Codice", "Oggetto", "Dettagli", "Indirizzo"],
    ...rows.map((row) => [
      new Date(row.ts * 1000).toISOString().replace("T", " ").slice(0, 19),
      row.username ?? "",
      AUDIT_LABELS[row.action] ?? row.action,
      row.action,
      row.target ?? "",
      row.detail ? JSON.stringify(row.detail) : "",
      row.ip ?? "",
    ]),
  ]);

  await audit(user, "audit.export", `${rows.length} righe`, filter.user || filter.action || filter.q ? filter : null);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vigil-registro-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
