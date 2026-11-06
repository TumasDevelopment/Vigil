import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { getLatestScan } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Sessione scaduta" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Riservato agli amministratori" }, { status: 403 });

  return NextResponse.json({ scan: await getLatestScan() }, { headers: { "Cache-Control": "no-store" } });
}
