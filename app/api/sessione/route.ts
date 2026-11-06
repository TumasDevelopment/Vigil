import { NextResponse, type NextRequest } from "next/server";
import { apiUser, touchSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** La pagina lo chiama quando la persona usa mouse o tastiera, e per attivare il chiosco. */
export async function POST(request: NextRequest) {
  // I cookie non distinguono le porte: gli altri siti di questo server li manderebbero anche qui.
  // Il chiosco toglie la chiusura per inattività, quindi può attivarlo solo la dashboard stessa.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return NextResponse.json({ error: "Richiesta non ammessa" }, { status: 403 });

  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Sessione scaduta" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { kiosk?: unknown } | null;
  await touchSession(typeof body?.kiosk === "boolean" ? body.kiosk : null);
  return NextResponse.json({ ok: true });
}
