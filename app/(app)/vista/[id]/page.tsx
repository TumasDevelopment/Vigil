import { notFound } from "next/navigation";
import { OverviewClient } from "@/components/OverviewClient";
import { requireUser } from "@/lib/auth";
import { getProfile } from "@/lib/queries";
import { parseRange } from "@/lib/ranges";
import { describeScope } from "@/lib/scope";

export const metadata = { title: "Vista salvata · Vigil" };

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { range } = await searchParams;

  const profile = await getProfile(Number(id), user);
  if (!profile) notFound();

  return (
    <OverviewClient
      key={profile.id}
      initialRange={parseRange(range ?? profile.range)}
      isAdmin={user.role === "admin"}
      scopeKey={`profilo-${profile.id}`}
      title={profile.name}
      subtitle={describeScope(profile)}
      defaultView={profile.view}
      defaultGroupBy={profile.groupBy}
      profile={profile}
    />
  );
}
