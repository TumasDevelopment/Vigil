import { apiJson, keyUser, withApiKey } from "@/lib/apikeys";
import { iso, outageView } from "@/lib/api-v1";
import { getEvents } from "@/lib/queries";
import { parseRange } from "@/lib/ranges";

export const dynamic = "force-dynamic";

const STATES: Record<string, "open" | "closed" | "noted"> = {
  open: "open",
  aperte: "open",
  closed: "closed",
  chiuse: "closed",
  noted: "noted",
  note: "noted",
};

/** Interruzioni di host e servizi. ?state=open|closed|noted e ?range= come nella pagina Eventi. */
export function GET(request: Request) {
  return withApiKey(request, "read", async (key) => {
    const params = new URL(request.url).searchParams;
    const state = STATES[params.get("state") ?? params.get("stato") ?? ""];
    const data = await getEvents(keyUser(key), parseRange(params.get("range")), state);
    return apiJson({ range: data.range, serverTime: iso(data.serverTime), outages: data.outages.map(outageView) });
  });
}
