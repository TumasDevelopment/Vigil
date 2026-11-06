import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { getLongOffline } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Sessione scaduta" }, { status: 401 });

  return NextResponse.json(await getLongOffline(user), { headers: { "Cache-Control": "no-store" } });
}
