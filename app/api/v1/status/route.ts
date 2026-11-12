import { apiJson, keyUser, withApiKey } from "@/lib/apikeys";
import { iso } from "@/lib/api-v1";
import { getHostSummaries, getPingerStatus } from "@/lib/queries";
import type { HostStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES: HostStatus[] = ["online", "unstable", "offline", "unreachable", "maintenance", "unknown", "paused"];

/** Riepilogo per cruscotti esterni: quanti host in ogni stato e chi non è online. */
export function GET(request: Request) {
  return withApiKey(request, "read", async (key) => {
    const [hosts, pinger] = await Promise.all([getHostSummaries(keyUser(key)), getPingerStatus()]);
    const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<HostStatus, number>;
    for (const host of hosts) counts[host.status] += 1;

    return apiJson({
      generatedAt: new Date().toISOString(),
      pinger: { healthy: pinger.healthy, lastRun: iso(pinger.lastBeat) },
      total: hosts.length,
      counts,
      problems: hosts
        .filter((host) => host.status === "offline" || host.status === "unstable" || host.status === "unreachable")
        .map((host) => ({ id: host.id, name: host.name, status: host.status, since: iso(host.since), reason: host.reason })),
    });
  });
}
