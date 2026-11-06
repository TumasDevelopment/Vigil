import { notFound } from "next/navigation";
import { HostDetailClient } from "@/components/HostDetailClient";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canSeeHost } from "@/lib/queries";
import { parseRange } from "@/lib/ranges";

export default async function HostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const { rowCount } = await db().query("SELECT 1 FROM hosts WHERE id = $1", [id]);
  if (!rowCount || !(await canSeeHost(user, id))) notFound();

  const { range } = await searchParams;
  return (
    <HostDetailClient
      hostId={id}
      initialRange={parseRange(range)}
      ackAs={user.role === "admin" ? user.username : null}
    />
  );
}
