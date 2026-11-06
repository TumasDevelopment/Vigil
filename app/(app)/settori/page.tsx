import { OverviewClient } from "@/components/OverviewClient";
import { requireUser } from "@/lib/auth";
import { parseRange } from "@/lib/ranges";

export const metadata = { title: "Per settore · Vigil" };

export default async function SectorsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const { range } = await searchParams;
  return (
    <OverviewClient
      initialRange={parseRange(range)}
      isAdmin={user.role === "admin"}
      scopeKey="settori"
      title="Per settore"
      subtitle="La rete divisa per reparto o zona"
      defaultView="summary"
      defaultGroupBy="sector"
    />
  );
}
