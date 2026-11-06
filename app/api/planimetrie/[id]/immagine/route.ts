import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { getFloorPlanImage } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Sessione scaduta" }, { status: 401 });

  const image = await getFloorPlanImage(Number((await params).id), user);
  if (!image) return NextResponse.json({ error: "Planimetria non trovata" }, { status: 404 });

  // L'indirizzo cambia con l'immagine, quindi il browser può tenerla. "private": solo il suo, nessun proxy.
  return new Response(new Uint8Array(image.image), {
    headers: {
      "Content-Type": image.mime,
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
