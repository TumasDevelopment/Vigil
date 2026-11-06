import { MaintenanceAdmin } from "@/components/MaintenanceAdmin";
import { requireAdmin } from "@/lib/auth";
import { listHosts, listMaintenance } from "@/lib/queries";

export const metadata = { title: "Manutenzioni · Vigil" };

export default async function MaintenancePage() {
  await requireAdmin();
  const [windows, hosts] = await Promise.all([listMaintenance(), listHosts()]);
  return (
    <MaintenanceAdmin
      windows={windows}
      hosts={hosts.map((host) => ({ id: host.id, name: host.name, sector: host.group_name }))}
    />
  );
}
