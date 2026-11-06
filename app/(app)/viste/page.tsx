import { ProfilesAdmin } from "@/components/ProfilesAdmin";
import { requireUser } from "@/lib/auth";
import { listProfiles, listVisibleHosts } from "@/lib/queries";

export const metadata = { title: "Viste salvate · Vigil" };

export default async function ProfilesPage() {
  const user = await requireUser();
  const [profiles, hosts] = await Promise.all([listProfiles(user), listVisibleHosts(user)]);

  return (
    <ProfilesAdmin
      profiles={profiles}
      hosts={hosts.map((host) => ({
        id: host.id,
        name: host.name,
        address: host.address,
        sector: host.group_name,
        type: host.device_type,
      }))}
      isAdmin={user.role === "admin"}
    />
  );
}
