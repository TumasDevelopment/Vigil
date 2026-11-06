import { networkInterfaces } from "node:os";
import { DiscoveryAdmin } from "@/components/DiscoveryAdmin";
import { requireAdmin } from "@/lib/auth";
import { listHosts } from "@/lib/queries";
import { defaultSubnet } from "@/lib/subnet.mjs";

export const metadata = { title: "Ricerca sulla rete · Vigil" };

export default async function DiscoveryPage() {
  await requireAdmin();
  const hosts = await listHosts();
  const sectors = [...new Set(hosts.map((host) => host.group_name).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "it"),
  );
  return <DiscoveryAdmin suggestion={defaultSubnet(networkInterfaces())} sectors={sectors} />;
}
