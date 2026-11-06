import { NextResponse, type NextRequest } from "next/server";
import { apiUser } from "@/lib/auth";
import { getHostDetail } from "@/lib/queries";
import { parseRange } from "@/lib/ranges";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Sessione scaduta" }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Host non trovato" }, { status: 404 });
  }

  const data = await getHostDetail(id, parseRange(request.nextUrl.searchParams.get("range")), user);
  if (!data) return NextResponse.json({ error: "Host non trovato" }, { status: 404 });

  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
