import { ServicesClient } from "@/components/ServicesClient";
import { requireUser } from "@/lib/auth";
import { listHosts } from "@/lib/queries";

export const metadata = { title: "Servizi · Vigil" };

export default async function ServicesPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  // L'elenco degli host serve solo al modulo, che è riservato agli amministratori
  const hosts = isAdmin ? await listHosts() : [];

  return (
    <ServicesClient
      isAdmin={isAdmin}
      hosts={hosts.map((host) => ({ id: host.id, name: host.name, address: host.address }))}
    />
  );
}
