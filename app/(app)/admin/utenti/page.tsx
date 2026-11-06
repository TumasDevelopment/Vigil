import { UserAdmin } from "@/components/UserAdmin";
import { requireAdmin } from "@/lib/auth";
import { listHosts, listUsers } from "@/lib/queries";

export const metadata = { title: "Utenti · Vigil" };

export default async function UserAdminPage() {
  const admin = await requireAdmin();
  const [users, hosts] = await Promise.all([listUsers(), listHosts()]);
  return (
    <UserAdmin
      users={users}
      hosts={hosts.map((host) => ({
        id: host.id,
        name: host.name,
        address: host.address,
        sector: host.group_name,
        type: host.device_type,
      }))}
      currentUserId={admin.id}
    />
  );
}
