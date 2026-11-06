import { OverviewClient } from "@/components/OverviewClient";
import { requireUser } from "@/lib/auth";
import { parseRange } from "@/lib/ranges";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const { range } = await searchParams;
  return (
    <OverviewClient
      initialRange={parseRange(range)}
      isAdmin={user.role === "admin"}
      scopeKey="all"
      title="Panoramica"
      subtitle="Stato della rete in tempo reale"
      defaultView="cards"
      defaultGroupBy="none"
    />
  );
}
