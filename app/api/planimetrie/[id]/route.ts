import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { getFloorPlan } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Sessione scaduta" }, { status: 401 });

  const plan = await getFloorPlan(Number((await params).id), user);
  if (!plan) return NextResponse.json({ error: "Planimetria non trovata" }, { status: 404 });

  return NextResponse.json(plan, { headers: { "Cache-Control": "no-store" } });
}
