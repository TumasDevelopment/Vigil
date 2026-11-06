import { NextResponse, type NextRequest } from "next/server";
import { apiUser } from "@/lib/auth";
import { getOverview } from "@/lib/queries";
import { parseRange } from "@/lib/ranges";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Sessione scaduta" }, { status: 401 });

  const data = await getOverview(parseRange(request.nextUrl.searchParams.get("range")), user);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
