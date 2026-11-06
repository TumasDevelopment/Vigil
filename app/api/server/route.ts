import { NextResponse, type NextRequest } from "next/server";
import { apiUser } from "@/lib/auth";
import { getServerData } from "@/lib/queries";
import { parseRange } from "@/lib/ranges";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Sessione scaduta" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Riservato agli amministratori" }, { status: 403 });

  const data = await getServerData(parseRange(request.nextUrl.searchParams.get("range")));
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
