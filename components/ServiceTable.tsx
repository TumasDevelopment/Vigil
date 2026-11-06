import Link from "next/link";
import type { ReactNode } from "react";
import { deleteServiceAction } from "@/lib/actions";
import { fmtDuration, fmtMs } from "@/lib/format";
import type { ServiceKind, ServiceRow, ServiceStatus } from "@/lib/types";
import { ConfirmSubmit } from "./forms";
import { IconOffline, IconOnline, IconPause, IconUnknown, IconWarning } from "./icons";

export const SERVICE_KINDS: { key: ServiceKind; label: string }[] = [
  { key: "tcp", label: "Porta TCP" },
  { key: "http", label: "Sito web" },
  { key: "cert", label: "Scadenza certificato" },
];

const BADGES: Record<ServiceStatus, { modifier: string; label: string; icon: ReactNode }> = {
  ok: { modifier: "online", label: "Attivo", icon: <IconOnline /> },
  warn: { modifier: "unstable", label: "Attenzione", icon: <IconWarning /> },
  failed: { modifier: "offline", label: "Non risponde", icon: <IconOffline /> },
  unknown: { modifier: "unknown", label: "In attesa", icon: <IconUnknown /> },
};

export function ServiceBadge({ service }: { service: ServiceRow }) {
  if (service.paused) {
    return (
      <span className="badge badge--paused">
        <IconPause />
        In pausa
      </span>
    );
  }
  const badge = BADGES[service.status];
  return (
    <span className={`badge badge--${badge.modifier}`}>
      {badge.icon}
      {badge.label}
    </span>
  );
}

const target = (service: ServiceRow) => (service.kind === "tcp" ? `${service.address}:${service.port}` : service.url);

export function ServiceTable({
  services,
  now,
  showHost = true,
  onEdit,
}: {
  services: ServiceRow[];
  now: number;
  showHost?: boolean;
  /** Solo per gli amministratori */
  onEdit?: (service: ServiceRow) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Stato</th>
            <th>Servizio</th>
            {showHost && <th>Host</th>}
            <th>Dettaglio</th>
            <th className="num">Risposta</th>
            <th className="num">Da</th>
            {onEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {services.map((service) => (
            <tr key={service.id}>
              <td>
                <ServiceBadge service={service} />
              </td>
              <td>
                <span className="cell-main">{service.name}</span>
                <span className="cell-sub">{target(service)}</span>
              </td>
              {showHost && (
                <td>
                  <Link className="cell-main" href={`/host/${service.hostId}`}>
                    {service.hostName}
                  </Link>
                  {service.sector && <span className="cell-sub">{service.sector}</span>}
                </td>
              )}
              <td className="muted">{service.detail || "—"}</td>
              <td className="num">{service.status === "failed" ? "—" : fmtMs(service.ms)}</td>
              <td className="num muted">{service.since ? fmtDuration(now - service.since) : "—"}</td>
              {onEdit && (
                <td className="actions">
                  <button type="button" className="btn btn--small" onClick={() => onEdit(service)}>
                    Modifica
                  </button>
                  <form action={deleteServiceAction}>
                    <input type="hidden" name="id" value={service.id} />
                    <ConfirmSubmit label="Elimina" confirmLabel="Confermi?" />
                  </form>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
