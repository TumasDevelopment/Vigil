import { EventsClient } from "@/components/EventsClient";
import { requireUser } from "@/lib/auth";
import { parseRange } from "@/lib/ranges";

export const metadata = { title: "Eventi · Vigil" };

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const { range } = await searchParams;
  return (
    <EventsClient initialRange={parseRange(range ?? "24h")} ackAs={user.role === "admin" ? user.username : null} />
  );
}
