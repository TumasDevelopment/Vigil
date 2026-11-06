import { ServerClient } from "@/components/ServerClient";
import { requireAdmin } from "@/lib/auth";
import { parseRange } from "@/lib/ranges";

export const metadata = { title: "Server · Vigil" };

export default async function ServerPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireAdmin();
  const { range } = await searchParams;
  return <ServerClient initialRange={parseRange(range ?? "6h")} />;
}
