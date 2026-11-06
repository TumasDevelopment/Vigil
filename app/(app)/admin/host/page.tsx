import { HostAdmin } from "@/components/HostAdmin";
import { requireAdmin } from "@/lib/auth";
import { listHosts, listTypeThresholds } from "@/lib/queries";

export const metadata = { title: "Host · Vigil" };

export default async function HostAdminPage() {
  await requireAdmin();
  const [hosts, thresholds] = await Promise.all([listHosts(), listTypeThresholds()]);
  return <HostAdmin hosts={hosts} thresholds={thresholds} />;
}
