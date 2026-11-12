import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { apiUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv.mjs";
import { HOST_COLUMNS, type HostColumn } from "@/lib/host-csv";
import { listHosts } from "@/lib/queries";
import { deviceLabel } from "@/lib/scope";

export const dynamic = "force-dynamic";

type HostRow = Awaited<ReturnType<typeof listHosts>>[number];

const flag = (value: boolean) => (value ? "sì" : "no");
/** Con il separatore ";" Excel in italiano si aspetta la virgola decimale; l'import accetta entrambe. */
const decimal = (value: number | null) => (value === null ? "" : String(value).replace(".", ","));

/** Le stesse colonne che l'import riconosce: il file si può modificare e reimportare. */
export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Sessione scaduta" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Riservato agli amministratori" }, { status: 403 });

  const hosts = await listHosts();
  // Il collegamento si scrive con l'indirizzo: è unico, il nome no
  const addresses = new Map(hosts.map((host) => [host.id, host.address]));

  const cell: Record<HostColumn, (host: HostRow) => string> = {
    name: (host) => host.name,
    address: (host) => host.address,
    sector: (host) => host.group_name,
    type: (host) => deviceLabel(host.device_type),
    ping: (host) => flag(host.ping_enabled),
    parent: (host) => (host.parent_id === null ? "" : (addresses.get(host.parent_id) ?? "")),
    critical: (host) => flag(host.critical),
    publicLabel: (host) => host.public_label ?? "",
    latencyWarn: (host) => decimal(host.latency_warn_ms),
    lossWarn: (host) => decimal(host.loss_warn_pct),
    manufacturer: (host) => host.manufacturer ?? "",
    model: (host) => host.model ?? "",
    serial: (host) => host.serial ?? "",
    firmware: (host) => host.firmware ?? "",
    location: (host) => host.location ?? "",
    owner: (host) => host.owner ?? "",
    purchasedOn: (host) => host.purchased_on ?? "",
    warrantyUntil: (host) => host.warranty_until ?? "",
    inventoryNote: (host) => host.inventory_note ?? "",
  };

  const rows = [
    HOST_COLUMNS.map((column) => column.header),
    ...hosts.map((host) => HOST_COLUMNS.map((column) => cell[column.key](host))),
  ];

  await audit(user, "host.export", `${hosts.length} host`);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows, ";"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vigil-host-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
