import { apiError, apiJson, keyUser, withApiKey } from "@/lib/apikeys";
import { iso } from "@/lib/api-v1";
import { getAlertFeed } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Avvisi più recenti di ?after=<id>. Senza after si riceve solo `latest`: il client parte da lì
 * e richiede con after=latest, come fa il client Windows.
 */
export function GET(request: Request) {
  return withApiKey(request, "read", async (key) => {
    const text = new URL(request.url).searchParams.get("after");
    const after = text === null || text === "" ? null : Number(text);
    if (after !== null && (!Number.isSafeInteger(after) || after < 0)) return apiError(400, "after: id numerico.");

    const feed = await getAlertFeed(keyUser(key), after);
    return apiJson({
      latest: feed.latest,
      more: feed.more,
      pinger: { healthy: feed.pinger.healthy, lastRun: iso(feed.pinger.lastBeat) },
      alerts: feed.alerts.map((alert) => ({ ...alert, ts: iso(alert.ts) })),
    });
  });
}
