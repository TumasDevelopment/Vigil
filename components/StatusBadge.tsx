import type { HostStatus } from "@/lib/types";
import { IconOffline, IconOnline, IconPause, IconUnknown, IconUnreachable, IconWarning, IconWrench } from "./icons";

export const STATUS_LABEL: Record<HostStatus, string> = {
  online: "Online",
  unstable: "Instabile",
  offline: "Offline",
  unreachable: "Non raggiungibile",
  maintenance: "In manutenzione",
  unknown: "Nessun dato",
  paused: "In pausa",
};

const ICONS = {
  online: IconOnline,
  unstable: IconWarning,
  offline: IconOffline,
  unreachable: IconUnreachable,
  maintenance: IconWrench,
  unknown: IconUnknown,
  paused: IconPause,
};

export function StatusIcon({ status }: { status: HostStatus }) {
  const Icon = ICONS[status];
  return <Icon />;
}

// Lo stato non si legge mai dal solo colore: c'è sempre icona e testo.
export function StatusBadge({ status }: { status: HostStatus }) {
  const Icon = ICONS[status];
  return (
    <span className={`badge badge--${status}`}>
      <Icon />
      {STATUS_LABEL[status]}
    </span>
  );
}
