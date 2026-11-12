import { ReportAdmin } from "@/components/ReportAdmin";
import { requireAdmin } from "@/lib/auth";
import { getAlertSettings, listReports } from "@/lib/queries-enterprise";
import { currentMonth, monthLabel, previousMonth } from "@/lib/report.mjs";

export const metadata = { title: "Report · Vigil" };
export const dynamic = "force-dynamic";

export default async function ReportPage() {
  await requireAdmin();
  const [reports, alerts] = await Promise.all([listReports(), getAlertSettings()]);
  const now = new Date();
  const current = currentMonth(now, alerts.timeZone);
  return (
    <ReportAdmin
      reports={reports}
      current={current}
      currentLabel={monthLabel(current)}
      lastClosed={previousMonth(now, alerts.timeZone)}
    />
  );
}
