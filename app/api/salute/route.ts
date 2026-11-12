import { NextResponse } from "next/server";
import { getHealth } from "@/lib/queries-enterprise";

export const dynamic = "force-dynamic";

/**
 * Per chi controlla Vigil da fuori (Uptime Kuma, un altro monitor, un cron): pubblica,
 * senza nomi né indirizzi. 200 se database e pinger funzionano, 503 altrimenti.
 */
export async function GET() {
  const health = await getHealth();
  return NextResponse.json(health, { status: health.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

export const HEAD = GET;
