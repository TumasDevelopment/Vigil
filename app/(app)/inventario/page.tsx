import { InventoryTable } from "@/components/InventoryTable";
import { requireUser } from "@/lib/auth";
import { getAlertSettings, getInventory } from "@/lib/queries-enterprise";

export const metadata = { title: "Inventario · Vigil" };
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const user = await requireUser();
  const [rows, alerts] = await Promise.all([getInventory(user), getAlertSettings()]);
  return (
    <InventoryTable
      rows={rows}
      isAdmin={user.role === "admin"}
      now={Math.floor(Date.now() / 1000)}
      warrantyDays={alerts.warrantyDays}
    />
  );
}
