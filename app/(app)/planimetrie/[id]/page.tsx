import { notFound } from "next/navigation";
import { PlanView } from "@/components/PlanView";
import { requireUser } from "@/lib/auth";
import { getFloorPlan, listHosts } from "@/lib/queries";

export const metadata = { title: "Planimetria · Vigil" };

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const plan = await getFloorPlan(Number((await params).id), user);
  if (!plan) notFound();

  const canEdit = user.role === "admin";
  const hosts = canEdit ? await listHosts() : [];
  return (
    <PlanView
      initial={plan}
      canEdit={canEdit}
      hosts={hosts.map((host) => ({ id: host.id, name: host.name, sector: host.group_name }))}
    />
  );
}
