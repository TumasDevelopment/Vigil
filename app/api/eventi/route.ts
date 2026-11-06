import { NextResponse, type NextRequest } from "next/server";
import { apiUser } from "@/lib/auth";
import { getEvents } from "@/lib/queries";
import { parseRange } from "@/lib/ranges";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Sessione scaduta" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const state = params.get("stato");
  const data = await getEvents(
    user,
    parseRange(params.get("range")),
    state === "open" || state === "closed" || state === "noted" ? state : undefined,
  );
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
