import { DeadlinesAdmin } from "@/components/DeadlinesAdmin";
import { requireAdmin } from "@/lib/auth";
import { getAlertSettings, getDeadlines } from "@/lib/queries-enterprise";

export const metadata = { title: "Scadenze · Vigil" };
export const dynamic = "force-dynamic";

export default async function DeadlinesPage() {
  const admin = await requireAdmin();
  const [deadlines, alerts] = await Promise.all([getDeadlines(admin), getAlertSettings()]);
  return (
    <DeadlinesAdmin
      domains={deadlines.domains}
      certs={deadlines.certs}
      warranties={deadlines.warranties}
      warrantyDays={alerts.warrantyDays}
      now={Math.floor(Date.now() / 1000)}
    />
  );
}
