import { PlansList } from "@/components/PlansList";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Planimetrie · Vigil" };

export default async function PlansPage() {
  const user = await requireUser();
  return <PlansList canEdit={user.role === "admin"} />;
}
