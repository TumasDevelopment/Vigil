import { OverviewClient } from "@/components/OverviewClient";
import { requireUser } from "@/lib/auth";
import { parseRange } from "@/lib/ranges";

export const metadata = { title: "Per tipo · Vigil" };

export default async function TypesPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const { range } = await searchParams;
  return (
    <OverviewClient
      initialRange={parseRange(range)}
      isAdmin={user.role === "admin"}
      scopeKey="tipi"
      title="Per tipo"
      subtitle="La rete divisa per tipo di dispositivo"
      defaultView="summary"
      defaultGroupBy="type"
    />
  );
}
