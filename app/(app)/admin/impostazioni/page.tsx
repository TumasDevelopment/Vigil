import { SettingsAdmin } from "@/components/SettingsAdmin";
import { requireAdmin } from "@/lib/auth";
import { getAlertSettings, getBackupState, getStatusSettings } from "@/lib/queries-enterprise";

export const metadata = { title: "Impostazioni · Vigil" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin();
  const [alerts, status, backup] = await Promise.all([getAlertSettings(), getStatusSettings(), getBackupState()]);
  return <SettingsAdmin alerts={alerts} status={status} backup={backup} heartbeat={Boolean(process.env.HEARTBEAT_URL)} />;
}
