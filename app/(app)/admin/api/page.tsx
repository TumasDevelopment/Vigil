import { ApiKeysAdmin } from "@/components/ApiKeysAdmin";
import { requireAdmin } from "@/lib/auth";
import { listApiKeys } from "@/lib/queries-enterprise";

export const metadata = { title: "Chiavi API · Vigil" };
export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  await requireAdmin();
  const keys = await listApiKeys();
  return <ApiKeysAdmin keys={keys} now={Math.floor(Date.now() / 1000)} />;
}
