import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { apiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAlertSettings, getReportPdf } from "@/lib/queries-enterprise";
import { collectReport, currentMonth, isMonth, monthLabel, renderReport } from "@/lib/report.mjs";

export const dynamic = "force-dynamic";

/** Il PDF salvato del mese. Se manca (mese in corso o report mai generato) lo si prepara al volo, senza salvarlo. */
export async function GET(_request: Request, { params }: { params: Promise<{ mese: string }> }) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Sessione scaduta" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Riservato agli amministratori" }, { status: 403 });

  const month = (await params).mese.replace(/\.pdf$/i, "");
  if (!isMonth(month)) return NextResponse.json({ error: "Mese non valido" }, { status: 404 });

  let pdf = await getReportPdf(month);
  if (!pdf) {
    const { timeZone } = await getAlertSettings();
    if (month > currentMonth(new Date(), timeZone)) {
      return NextResponse.json({ error: "Questo mese non è ancora iniziato" }, { status: 404 });
    }
    const summary = await collectReport(
      (sql: string, values: unknown[]) => db().query(sql, values).then((result) => result.rows),
      { month, timeZone },
    );
    pdf = renderReport(summary);
  }

  await audit(user, "report.download", monthLabel(month));
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="vigil-report-${month}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
