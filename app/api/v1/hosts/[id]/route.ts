import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { apiError, apiJson, keyUser, withApiKey } from "@/lib/apikeys";
import { hostView, rowId } from "@/lib/api-v1";
import { db } from "@/lib/db";
import { getHostSummaries } from "@/lib/queries";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ id: string }>;
}

export function GET(request: Request, { params }: Context) {
  return withApiKey(request, "read", async (key) => {
    const id = rowId((await params).id);
    const host = id === null ? undefined : (await getHostSummaries(keyUser(key))).find((item) => item.id === id);
    return host ? apiJson({ host: hostView(host) }) : apiError(404, "Host non trovato.");
  });
}

export function DELETE(request: Request, { params }: Context) {
  return withApiKey(request, "write", async (key) => {
    const id = rowId((await params).id);
    if (id === null) return apiError(404, "Host non trovato.");
    const { rows } = await db().query<{ name: string; address: string }>(
      "DELETE FROM hosts WHERE id = $1 RETURNING name, address",
      [id],
    );
    if (!rows[0]) return apiError(404, "Host non trovato.");
    await audit({ id: 0, username: `api:${key.name}` }, "host.delete", `${rows[0].name} (${rows[0].address})`);
    revalidatePath("/admin/host");
    revalidatePath("/");
    return apiJson({ deleted: id });
  });
}
