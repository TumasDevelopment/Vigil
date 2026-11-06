import Link from "next/link";
import { fmtDuration, fmtMs, fmtPct, fmtUntil, fmtUptime } from "@/lib/format";
import { STATE_COLORS } from "@/lib/palette";
import type { RangeKey } from "@/lib/ranges";
import { countStatus, deviceLabel, isDeviceType, mean, type GroupBy, type HostGroup, type ViewMode } from "@/lib/scope";
import type { HostRow } from "@/lib/types";
import { DeviceIcon } from "./DeviceIcon";
import {
  IconLayers,
  IconOffline,
  IconOnline,
  IconPause,
  IconUnknown,
  IconUnreachable,
  IconWarning,
  IconWrench,
} from "./icons";
import { Sparkline } from "./Sparkline";
import { StatusBadge } from "./StatusBadge";

interface ViewProps {
  hosts: HostRow[];
  range: RangeKey;
  now: number;
}

const isDown = (host: HostRow) => host.status === "offline" || host.status === "unreachable";

/** Il dato che conta in quello stato: da quanto è giù, fino a quando è fermo, quanto risponde. */
function liveValue(host: HostRow, now: number, fallback = "—") {
  if (isDown(host) && host.since !== null) return fmtDuration(now - host.since);
  if (host.maintenanceUntil !== null) return fmtUntil(host.maintenanceUntil, now);
  return host.status === "online" || host.status === "unstable" ? fmtMs(host.rtt) : fallback;
}

export function StatusMeter({ counts }: { counts: ReturnType<typeof countStatus> }) {
  const parts: [number, string][] = [
    [counts.online, STATE_COLORS.online],
    [counts.unstable, STATE_COLORS.partial],
    [counts.offline, STATE_COLORS.offline],
    [counts.unreachable, STATE_COLORS.unreachable],
    [counts.maintenance, STATE_COLORS.maintenance],
    [counts.unknown, STATE_COLORS.nodata],
  ];
  return (
    <span className="meter" aria-hidden="true">
      {parts.map(([count, color]) => count > 0 && <span key={color} style={{ flex: count, background: color }} />)}
    </span>
  );
}

function HostCard({ host, range, now }: { host: HostRow; range: RangeKey; now: number }) {
  return (
    <Link
      href={`/host/${host.id}?range=${range}`}
      className={`host-card ${isDown(host) ? `host-card--${host.status}` : ""}`}
    >
      <div className="host-card__top">
        <StatusBadge status={host.status} />
        <span className="host-card__rtt">{liveValue(host, now)}</span>
      </div>
      <div className="host-card__name" title={host.name}>
        <DeviceIcon type={host.type} />
        <span className="truncate">{host.name}</span>
      </div>
      <div className="host-card__addr">
        {host.address}
        {host.sector ? ` · ${host.sector}` : ""}
      </div>
      {host.reason && (
        <div className="host-card__reason" title={host.reason}>
          {host.reason}
        </div>
      )}
      <div className="host-card__spark">
        <Sparkline values={host.lat} />
      </div>
      <div className="host-card__foot">
        <span>
          Disponibilità <b>{fmtUptime(host.uptime)}</b>
        </span>
        <span>
          Perdita <b>{fmtPct(host.lossRange, 1)}</b>
        </span>
      </div>
    </Link>
  );
}

function HostCards({ hosts, range, now }: ViewProps) {
  return (
    <div className="host-grid">
      {hosts.map((host) => (
        <HostCard key={host.id} host={host} range={range} now={now} />
      ))}
    </div>
  );
}

function HostTable({ hosts, range, now }: ViewProps) {
  return (
    <div className="panel">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Stato</th>
              <th>Host</th>
              <th>Settore</th>
              <th>Tipo</th>
              <th className="num">Latenza</th>
              <th className="num">Media</th>
              <th className="num">Perdita</th>
              <th className="num">Disponibilità</th>
              <th>Andamento</th>
              <th className="num">Da</th>
            </tr>
          </thead>
          <tbody>
            {hosts.map((host) => (
              <tr key={host.id}>
                <td>
                  <StatusBadge status={host.status} />
                </td>
                <td>
                  <Link className="cell-main" href={`/host/${host.id}?range=${range}`}>
                    {host.name}
                  </Link>
                  <span className="cell-sub">{host.address}</span>
                  {host.reason && <span className="cell-sub">{host.reason}</span>}
                </td>
                <td className="muted">{host.sector || "—"}</td>
                <td className="muted nowrap">{deviceLabel(host.type)}</td>
                <td className="num">{isDown(host) ? "—" : fmtMs(host.rtt)}</td>
                <td className="num">{fmtMs(host.avgRtt)}</td>
                <td className="num">{fmtPct(host.lossRange, 1)}</td>
                <td className="num">{fmtUptime(host.uptime)}</td>
                <td>
                  <Sparkline values={host.lat} className="spark--row" />
                </td>
                <td className="num muted">{host.since ? fmtDuration(now - host.since) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Vista densa per un monitor a parete: tanti host, si legge da lontano. */
function HostWall({ hosts, range, now }: ViewProps) {
  return (
    <div className="wall">
      {hosts.map((host) => (
        <Link
          key={host.id}
          href={`/host/${host.id}?range=${range}`}
          className={`wall-tile wall-tile--${host.status}`}
          title={host.reason ?? undefined}
        >
          <span className="wall-tile__name" title={host.name}>
            <DeviceIcon type={host.type} />
            <span className="truncate">{host.name}</span>
          </span>
          <span className="wall-tile__foot">
            <StatusBadge status={host.status} />
            <span className="wall-tile__value">{liveValue(host, now, "")}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

const VIEW_COMPONENTS = { cards: HostCards, table: HostTable, wall: HostWall };

export function HostSections({
  groups,
  by,
  view,
  range,
  now,
}: {
  groups: HostGroup<HostRow>[];
  by: GroupBy;
  view: Exclude<ViewMode, "summary">;
  range: RangeKey;
  now: number;
}) {
  const View = VIEW_COMPONENTS[view];
  if (by === "none") return <View hosts={groups[0].hosts} range={range} now={now} />;

  return (
    <>
      {groups.map((group) => {
        const counts = countStatus(group.hosts);
        return (
          <section key={group.key} className="group">
            <header className="group__head">
              <GroupIcon group={group.key} />
              <h2>{group.label}</h2>
              <span className="group__count">
                {counts.online + counts.unstable} su {counts.monitored} online
              </span>
              {counts.offline > 0 && (
                <span className="badge badge--offline">
                  <IconOffline />
                  {counts.offline} offline
                </span>
              )}
              {counts.unreachable > 0 && (
                <span className="badge badge--unreachable">
                  <IconUnreachable />
                  {counts.unreachable} non raggiungibili
                </span>
              )}
              {counts.maintenance > 0 && (
                <span className="badge badge--maintenance">
                  <IconWrench />
                  {counts.maintenance} in manutenzione
                </span>
              )}
            </header>
            <View hosts={group.hosts} range={range} now={now} />
          </section>
        );
      })}
    </>
  );
}

function GroupIcon({ group }: { group: string }) {
  return isDeviceType(group) ? (
    <DeviceIcon type={group} />
  ) : (
    <span className="device-icon">
      <IconLayers />
    </span>
  );
}

function GroupBadge({ counts }: { counts: ReturnType<typeof countStatus> }) {
  if (counts.offline > 0) {
    return (
      <span className="badge badge--offline">
        <IconOffline />
        {counts.offline} offline
      </span>
    );
  }
  if (counts.unreachable > 0) {
    return (
      <span className="badge badge--unreachable">
        <IconUnreachable />
        {counts.unreachable} non raggiungibili
      </span>
    );
  }
  if (counts.unstable > 0) {
    return (
      <span className="badge badge--unstable">
        <IconWarning />
        {counts.unstable === 1 ? "1 instabile" : `${counts.unstable} instabili`}
      </span>
    );
  }
  if (counts.monitored === 0 && counts.maintenance > 0) {
    return (
      <span className="badge badge--maintenance">
        <IconWrench />
        In manutenzione
      </span>
    );
  }
  if (counts.monitored === 0) {
    return (
      <span className="badge badge--paused">
        <IconPause />
        In pausa
      </span>
    );
  }
  if (counts.online === 0) {
    return (
      <span className="badge badge--unknown">
        <IconUnknown />
        Nessun dato
      </span>
    );
  }
  return (
    <span className="badge badge--online">
      <IconOnline />
      Tutto online
    </span>
  );
}

function GroupCard({ group, onOpen }: { group: HostGroup<HostRow>; onOpen: (key: string) => void }) {
  const counts = countStatus(group.hosts);
  const monitored = group.hosts.filter((host) => host.status !== "paused");
  const down = monitored.filter(isDown).map((host) => host.name);

  return (
    <button
      type="button"
      className={`group-card ${down.length > 0 ? "group-card--offline" : ""}`}
      onClick={() => onOpen(group.key)}
    >
      <span className="group-card__head">
        <GroupIcon group={group.key} />
        <span className="group-card__name truncate">{group.label}</span>
        <GroupBadge counts={counts} />
      </span>
      <span className="group-card__value">
        {counts.online + counts.unstable}
        <span className="tile__of">/ {counts.monitored} online</span>
      </span>
      <StatusMeter counts={counts} />
      <span className="host-card__foot">
        <span>
          Latenza <b>{fmtMs(mean(monitored.map((host) => host.avgRtt)))}</b>
        </span>
        <span>
          Disponibilità <b>{fmtUptime(mean(monitored.map((host) => host.uptime)))}</b>
        </span>
      </span>
      {down.length > 0 && (
        <span className="group-card__down">
          {down.slice(0, 3).join(", ")}
          {down.length > 3 ? ` e altri ${down.length - 3}` : ""}
        </span>
      )}
    </button>
  );
}

/** I gruppi con host offline stanno davanti: è lì che bisogna guardare. */
export function GroupSummary({ groups, onOpen }: { groups: HostGroup<HostRow>[]; onOpen: (key: string) => void }) {
  const downCount = (group: HostGroup<HostRow>) => group.hosts.filter(isDown).length;
  const sorted = [...groups].sort((a, b) => downCount(b) - downCount(a));
  return (
    <div className="group-grid">
      {sorted.map((group) => (
        <GroupCard key={group.key} group={group} onOpen={onOpen} />
      ))}
    </div>
  );
}
