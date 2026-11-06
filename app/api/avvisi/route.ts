import { NextResponse, type NextRequest } from "next/server";
import { deviceUser } from "@/lib/auth";
import { getAlertFeed } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** La legge il programma sul PC, non il browser: si autentica con un token, non con il cookie. */
export async function GET(request: NextRequest) {
  const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  const user = token ? await deviceUser(token) : null;
  if (!user) return NextResponse.json({ error: "Token non valido" }, { status: 401 });

  const after = request.nextUrl.searchParams.get("dopo");
  const data = await getAlertFeed(user, after !== null && /^\d{1,15}$/.test(after) ? Number(after) : null);

  return new NextResponse(JSON.stringify(data), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
