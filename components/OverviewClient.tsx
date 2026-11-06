"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtMs, fmtUptime } from "@/lib/format";
import { MAX_SERIES, SERIES_COLORS } from "@/lib/palette";
import { RANGES, type RangeKey } from "@/lib/ranges";
import {
  ALL_FILTER,
  ALL_PANELS,
  countStatus,
  GROUPINGS,
  groupHosts,
  inScope,
  isDeviceType,
  isGroupBy,
  isViewMode,
  mean,
  meanSeries,
  VIEWS,
  type GroupBy,
  type PanelKey,
  type ViewMode,
} from "@/lib/scope";
import type { HostRow, HostStatus, OverviewData, Profile } from "@/lib/types";
import { Modal } from "./forms";
import { GroupSummary, HostSections, StatusMeter } from "./HostViews";
import { IconClose, IconOffline } from "./icons";
import { OutageTable } from "./OutageTable";
import { newProfileDraft, ProfileForm, type ProfileDraft } from "./ProfileForm";
import { StateTimeline, TimelineLegend, type TimelineRow } from "./StateTimeline";
import { TimeSeriesChart, type ChartSeries } from "./TimeSeriesChart";
import { FilterSelect, HealthBanner, RangePicker, RefreshStatus } from "./Toolbar";
import { readStored, useLiveData, writeStored } from "./useLiveData";

const SEVERITY: Record<HostStatus, number> = {
  offline: 0,
  unreachable: 1,
  unstable: 2,
  unknown: 3,
  online: 4,
  maintenance: 5,
  paused: 6,
};

const LAYOUT_KEY = "vigil.layout";
const SLOTS_KEY = "vigil.serie";

type Slots = Record<number, number>;

const isMonitored = (host: HostRow) => host.status !== "paused";

/**
 * Ogni host nel grafico tiene il suo colore finché resta selezionato: filtrare
 * o togliere altri host non ridipinge i rimanenti. Ogni pagina e ogni settore o
 * tipo scelto ha la sua selezione, così aprendo un gruppo il grafico non è vuoto.
 */
function useSeriesSlots(hosts: HostRow[], key: string) {
  const [state, setState] = useState<{ key: string; slots: Slots } | null>(null);
  const slots = state?.key === key ? state.slots : null;

  useEffect(() => {
    if (slots || hosts.length === 0) return;

    const ids = new Set(hosts.map((host) => host.id));
    const stored = readStored<Slots>(key, {});
    const kept = Object.entries(stored).filter(
      ([id, slot]) => ids.has(Number(id)) && slot >= 0 && slot < MAX_SERIES,
    );

    if (kept.length > 0) {
      setState({ key, slots: Object.fromEntries(kept.map(([id, slot]) => [Number(id), slot])) });
      return;
    }
    const initial: Slots = {};
    hosts
      .filter((host) => host.enabled)
      .slice(0, MAX_SERIES)
      .forEach((host, index) => {
        initial[host.id] = index;
      });
    setState({ key, slots: initial });
  }, [hosts, key, slots]);

  // Un host uscito dal profilo non deve tenere occupato un colore
  const current = useMemo<Slots>(() => {
    const ids = new Set(hosts.map((host) => host.id));
    return Object.fromEntries(Object.entries(slots ?? {}).filter(([id]) => ids.has(Number(id))));
  }, [hosts, slots]);

  function update(next: Slots) {
    setState({ key, slots: next });
    writeStored(key, next);
  }

  return {
    slots: current,
    add(id: number) {
      const used = new Set(Object.values(current));
      const free = SERIES_COLORS.findIndex((_, index) => !used.has(index));
      if (free >= 0) update({ ...current, [id]: free });
    },
    remove(id: number) {
      const next = { ...current };
      delete next[id];
      update(next);
    },
  };
}

interface Props {
  initialRange: RangeKey;
  isAdmin: boolean;
  /** Identifica la pagina: ognuna ricorda la sua vista */
  scopeKey: string;
  title: string;
  subtitle: string;
  defaultView: ViewMode;
  defaultGroupBy: GroupBy;
  profile?: Profile;
}

export function OverviewClient({
  initialRange,
  isAdmin,
  scopeKey,
  title,
  subtitle,
  defaultView,
  defaultGroupBy,
  profile,
}: Props) {
  const router = useRouter();
  const [range, setRange] = useState(initialRange);
  const live = useLiveData<OverviewData>(`/api/overview?range=${range}`);
  const data = live.data;

  const [search, setSearch] = useState("");
  const [sector, setSector] = useState(ALL_FILTER);
  const [type, setType] = useState(ALL_FILTER);
  const [status, setStatus] = useState("");
  const [view, setView] = useState<ViewMode>(profile?.view ?? defaultView);
  const [groupBy, setGroupBy] = useState<GroupBy>(profile?.groupBy ?? defaultGroupBy);
  // Gruppo aperto dal riepilogo: qui resta il raggruppamento da ripristinare
  const [drilledFrom, setDrilledFrom] = useState<GroupBy | null>(null);
  const [editing, setEditing] = useState<ProfileDraft | null>(null);

  const layoutKey = `${LAYOUT_KEY}.${scopeKey}`;

  function changeRange(next: RangeKey) {
    setRange(next);
    window.history.replaceState(null, "", `?range=${next}`);
  }

  // Un profilo si apre sempre com'è stato salvato; le altre pagine ricordano la scelta
  useEffect(() => {
    if (profile) return;
    const stored = readStored<{ view?: unknown; groupBy?: unknown }>(layoutKey, {});
    if (isViewMode(stored.view)) setView(stored.view);
    if (isGroupBy(stored.groupBy)) setGroupBy(stored.groupBy);
  }, [layoutKey, profile]);

  function saveLayout(next: { view: ViewMode; groupBy: GroupBy }) {
    if (!profile && drilledFrom === null) writeStored(layoutKey, next);
  }

  // Dopo il salvataggio la pagina mostra il profilo come è stato appena configurato
  const appliedProfile = useRef(profile);
  useEffect(() => {
    if (!profile || appliedProfile.current === profile) return;
    appliedProfile.current = profile;
    setView(profile.view);
    setGroupBy(profile.groupBy);
    setDrilledFrom(null);
    setRange(profile.range);
    window.history.replaceState(null, "", `?range=${profile.range}`);
  }, [profile]);

  function backToSummary() {
    setView("summary");
    setGroupBy(drilledFrom ?? groupBy);
    setSector(ALL_FILTER);
    setType(ALL_FILTER);
    setDrilledFrom(null);
  }

  function changeView(next: ViewMode) {
    if (next === "summary" && drilledFrom !== null) {
      backToSummary();
      return;
    }
    setView(next);
    saveLayout({ view: next, groupBy });
  }

  function changeGroupBy(next: GroupBy) {
    setGroupBy(next);
    saveLayout({ view, groupBy: next });
  }

  const summary = view === "summary";
  // Il riepilogo è fatto di gruppi: senza raggruppamento userebbe un'unica scheda
  const by: GroupBy = summary && groupBy === "none" ? "sector" : groupBy;

  function openGroup(key: string) {
    if (by === "type") setType(key);
    else setSector(key);
    setDrilledFrom(by);
    setGroupBy("none");
    setView("cards");
  }

  const scoped = useMemo(() => {
    const hosts = data?.hosts ?? [];
    return profile ? hosts.filter((host) => inScope(host, profile)) : hosts;
  }, [data, profile]);

  const sectorOptions = useMemo(() => groupHosts(scoped, "sector"), [scoped]);
  const typeOptions = useMemo(() => groupHosts(scoped, "type"), [scoped]);

  const pool = useMemo(
    () =>
      scoped.filter(
        (host) => (sector === ALL_FILTER || host.sector === sector) && (type === ALL_FILTER || host.type === type),
      ),
    [scoped, sector, type],
  );

  // I filtri valgono per tutto ciò che sta sotto, così i numeri restano coerenti
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return pool
      .filter((host) => !status || host.status === status)
      .filter(
        (host) =>
          !needle || host.name.toLowerCase().includes(needle) || host.address.toLowerCase().includes(needle),
      )
      .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status]);
  }, [pool, search, status]);

  const groups = useMemo(() => groupHosts(visible, by), [visible, by]);
  const visibleIds = useMemo(() => new Set(visible.map((host) => host.id)), [visible]);

  const series = useSeriesSlots(pool, `${SLOTS_KEY}.${scopeKey}.${sector}.${type}`);

  const chartHosts = useMemo(
    () =>
      visible
        .filter((host) => series.slots[host.id] !== undefined)
        .sort((a, b) => series.slots[a.id] - series.slots[b.id]),
    [visible, series.slots],
  );

  // Nel riepilogo il colore segue il gruppo: filtrando, i gruppi rimasti non cambiano colore
  const groupOptions = by === "type" ? typeOptions : sectorOptions;
  const groupLines = useMemo<ChartSeries[]>(() => {
    if (!summary || !data) return [];
    return groupOptions.slice(0, MAX_SERIES).flatMap((option, slot) => {
      const hosts = groups.find((group) => group.key === option.key)?.hosts.filter(isMonitored) ?? [];
      if (hosts.length === 0) return [];
      return [
        {
          label: option.label,
          color: SERIES_COLORS[slot],
          values: meanSeries(hosts.map((host) => host.lat), data.t.length),
        },
      ];
    });
  }, [summary, data, groupOptions, groups]);

  const chartSeries = useMemo<ChartSeries[]>(
    () =>
      summary
        ? groupLines
        : chartHosts.map((host) => ({
            label: host.name,
            color: SERIES_COLORS[series.slots[host.id]],
            values: host.lat,
          })),
    [summary, groupLines, chartHosts, series.slots],
  );

  const addable = visible.filter((host) => series.slots[host.id] === undefined);
  const selectedCount = Object.keys(series.slots).length;

  const timelineRows = useMemo<TimelineRow[]>(() => {
    if (!data) return [];
    if (!summary) {
      return visible
        .filter(isMonitored)
        .map((host) => ({ id: host.id, name: host.name, up: host.up, spans: host.maintenance }));
    }
    return groups.flatMap((group) => {
      const hosts = group.hosts.filter(isMonitored);
      if (hosts.length === 0) return [];
      return [
        {
          id: group.key,
          name: group.label,
          up: meanSeries(hosts.map((host) => host.up), data.t.length),
          spans: hosts.flatMap((host) => host.maintenance),
        },
      ];
    });
  }, [data, summary, visible, groups]);

  const outages = (data?.outages ?? []).filter((outage) => visibleIds.has(outage.hostId));

  const monitored = visible.filter(isMonitored);
  const counts = countStatus(visible);
  const offlineNote =
    [
      counts.unreachable > 0 ? `${counts.unreachable} non raggiungibili` : "",
      counts.unstable > 0 ? `${counts.unstable} instabili` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "Nessun host instabile";

  const refetching = data !== null && data.range !== range;
  const rangeSeconds = RANGES[data?.range ?? range].seconds;
  const now = data?.serverTime ?? 0;
  const noHosts = data !== null && data.hosts.length === 0;
  const emptyProfile = data !== null && !noHosts && scoped.length === 0;

  const panels: PanelKey[] = profile?.panels ?? ALL_PANELS;
  const showLatency = panels.includes("latency");
  const showOutages = panels.includes("outages");

  const groupNoun = by === "type" ? "tipo" : "settore";
  const unassigned =
    summary &&
    scoped.length > 0 &&
    scoped.every((host) => (by === "type" ? host.type === "altro" : host.sector === ""));

  function openEditor() {
    if (profile) {
      // Si parte da ciò che è a schermo, così una vista provata si salva con un clic
      setEditing(drilledFrom === null ? { ...profile, view, groupBy, range } : profile);
      return;
    }
    setEditing(
      newProfileDraft(isAdmin, {
        sectors: sector === ALL_FILTER ? [] : [sector],
        types: isDeviceType(type) ? [type] : [],
        view,
        groupBy,
        range,
      }),
    );
  }

  function closeEditor(id?: number) {
    setEditing(null);
    if (id && !profile) router.push(`/vista/${id}`);
  }

  const latencyPanel = showLatency && (
    <section className="panel">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">Latenza</h2>
          <p className="panel__sub">
            {summary
              ? groupOptions.length > MAX_SERIES
                ? `Media per ${groupNoun}: i primi ${MAX_SERIES} di ${groupOptions.length}`
                : `Media degli host di ogni ${groupNoun}`
              : `Media per intervallo, fino a ${MAX_SERIES} host`}
          </p>
        </div>
      </div>
      <div className="legend">
        {summary
          ? groupLines.map((line) => (
              <span key={line.label} className="legend__item">
                <span className="legend__key" style={{ background: line.color }} />
                {line.label}
              </span>
            ))
          : chartHosts.map((host) => (
              <span key={host.id} className="legend__chip">
                <span className="legend__key" style={{ background: SERIES_COLORS[series.slots[host.id]] }} />
                <span className="legend__name" title={host.name}>
                  {host.name}
                </span>
                <button
                  type="button"
                  className="legend__remove"
                  aria-label={`Togli ${host.name} dal grafico`}
                  onClick={() => series.remove(host.id)}
                >
                  <IconClose />
                </button>
              </span>
            ))}
        {!summary && addable.length > 0 && selectedCount < MAX_SERIES && (
          <select
            className="select"
            aria-label="Aggiungi host al grafico"
            value=""
            onChange={(event) => series.add(Number(event.target.value))}
          >
            <option value="">+ Aggiungi host</option>
            {addable.map((host) => (
              <option key={host.id} value={host.id}>
                {host.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {data && chartSeries.length > 0 ? (
        <TimeSeriesChart
          t={data.t}
          series={chartSeries}
          rangeSeconds={rangeSeconds}
          format={fmtMs}
          unit="ms"
          ariaLabel={
            summary
              ? `Latenza media nel tempo per ${groupNoun}; i valori sono anche nelle schede del riepilogo`
              : "Latenza nel tempo degli host selezionati; i valori sono anche nella vista Tabella"
          }
        />
      ) : (
        <div className="empty">{summary ? "Nessun dato di latenza." : "Scegli almeno un host da mostrare."}</div>
      )}
    </section>
  );

  const outagesPanel = showOutages && (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Ultime interruzioni</h2>
        <Link className="panel__link" href={`/eventi?range=${range}`}>
          Tutti gli eventi
        </Link>
      </div>
      <OutageTable outages={outages.slice(0, 7)} now={now} range={range} compact />
    </section>
  );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <RefreshStatus live={live} />
      </header>

      <HealthBanner error={live.error} pinger={noHosts ? undefined : data?.pinger} />

      <div className="filterbar">
      <div className="toolbar">
        <RangePicker value={range} onChange={changeRange} />
        <input
          className="input"
          type="search"
          placeholder="Cerca nome o IP"
          aria-label="Cerca host"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {sectorOptions.length > 1 && (
          <FilterSelect
            label="Settore"
            allLabel="Tutti i settori"
            value={sector}
            options={sectorOptions}
            onChange={setSector}
          />
        )}
        {typeOptions.length > 1 && (
          <FilterSelect label="Tipo" allLabel="Tutti i tipi" value={type} options={typeOptions} onChange={setType} />
        )}
        <select className="select" aria-label="Stato" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Tutti gli stati</option>
          <option value="online">Online</option>
          <option value="unstable">Instabile</option>
          <option value="offline">Offline</option>
          <option value="unreachable">Non raggiungibile</option>
          <option value="maintenance">In manutenzione</option>
          <option value="unknown">Nessun dato</option>
          <option value="paused">In pausa</option>
        </select>
      </div>

      <div className="toolbar">
        {drilledFrom !== null && (
          <button type="button" className="btn" onClick={backToSummary}>
            ← Torna al riepilogo
          </button>
        )}
        <div className="seg" role="group" aria-label="Vista">
          {VIEWS.map((item) => (
            <button key={item.key} type="button" aria-pressed={view === item.key} onClick={() => changeView(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
        <label className="inline-field">
          Raggruppa per
          <select
            className="select"
            value={by}
            onChange={(event) => {
              if (isGroupBy(event.target.value)) changeGroupBy(event.target.value);
            }}
          >
            {GROUPINGS.filter((item) => !summary || item.key !== "none").map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="toolbar__end">
          {(!profile || profile.canEdit) && (
            <button type="button" className="btn" onClick={openEditor}>
              {profile ? "Modifica vista" : "Salva come vista"}
            </button>
          )}
        </div>
      </div>
      </div>

      {noHosts ? (
        <div className="panel empty">
          <p>{data?.restricted ? "Nessun dispositivo assegnato al tuo account." : "Nessun host configurato."}</p>
          {isAdmin ? (
            <Link className="btn btn--primary" href="/admin/host">
              Aggiungi il primo host
            </Link>
          ) : (
            <p>
              {data?.restricted
                ? "Chiedi a un amministratore di scegliere i dispositivi del tuo account."
                : "Chiedi a un amministratore di aggiungerli."}
            </p>
          )}
        </div>
      ) : emptyProfile ? (
        <div className="panel empty">
          <p>Questa vista non include nessun host.</p>
          {profile?.canEdit && <p>Usa Modifica vista per scegliere settori, tipi o singoli host.</p>}
        </div>
      ) : (
        <div className={`stack ${refetching ? "is-refetching" : ""}`}>
          {unassigned && (
            <div className="notice notice--hint">
              Nessun host ha ancora un {groupNoun}.{" "}
              {isAdmin ? (
                <Link href="/admin/host">Assegnalo nella pagina Host</Link>
              ) : (
                "Chiedi a un amministratore di assegnarlo."
              )}
            </div>
          )}

          {panels.includes("tiles") && (
            <div className="tiles">
              <div className="tile">
                <div className="tile__label">Host online</div>
                <div className="tile__value">
                  {counts.online + counts.unstable}
                  <span className="tile__of">/ {counts.monitored}</span>
                </div>
                <StatusMeter counts={counts} />
                {counts.maintenance > 0 && <div className="tile__note">{counts.maintenance} in manutenzione</div>}
              </div>
              <div className={`tile ${counts.offline > 0 ? "tile--critical" : ""}`}>
                <div className="tile__label">
                  {counts.offline > 0 && <IconOffline />}
                  Offline adesso
                </div>
                <div className="tile__value">{counts.offline}</div>
                <div className="tile__note">{offlineNote}</div>
              </div>
              <div className="tile">
                <div className="tile__label">Latenza media</div>
                <div className="tile__value">{fmtMs(mean(monitored.map((host) => host.avgRtt)))}</div>
                <div className="tile__note">{RANGES[range].recent}</div>
              </div>
              <div className="tile">
                <div className="tile__label">Disponibilità</div>
                <div className="tile__value">{fmtUptime(mean(monitored.map((host) => host.uptime)))}</div>
                <div className="tile__note">Media degli host</div>
              </div>
              <div className="tile">
                <div className="tile__label">Interruzioni</div>
                <div className="tile__value">{outages.filter((outage) => !outage.inMaintenance).length}</div>
                <div className="tile__note">{RANGES[range].recent}</div>
              </div>
            </div>
          )}

          {data && visible.length === 0 && <div className="panel empty">Nessun host corrisponde ai filtri.</div>}

          {data && visible.length > 0 && panels.includes("hosts") &&
            (view === "summary" ? (
              <GroupSummary groups={groups} onOpen={openGroup} />
            ) : (
              <HostSections groups={groups} by={by} view={view} range={range} now={now} />
            ))}

          {data && visible.length > 0 &&
            (showLatency && showOutages ? (
              <div className="grid-2">
                {latencyPanel}
                {outagesPanel}
              </div>
            ) : (
              latencyPanel || outagesPanel
            ))}

          {data && timelineRows.length > 0 && panels.includes("timeline") && (
            <section className="panel">
              <div className="panel__head">
                <div>
                  <h2 className="panel__title">Timeline di stato</h2>
                  <p className="panel__sub">
                    {summary
                      ? `Quota di host che hanno risposto, per ${groupNoun}`
                      : "Quando ogni host ha risposto, intervallo per intervallo"}
                  </p>
                </div>
                <TimelineLegend />
              </div>
              <StateTimeline
                rows={timelineRows}
                t={data.t}
                bucketSeconds={data.bucketSeconds}
                rangeSeconds={rangeSeconds}
                rangeQuery={range}
              />
            </section>
          )}
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? "Modifica vista" : "Salva come vista"}
          onClose={() => setEditing(null)}
          wide
        >
          <ProfileForm draft={editing} hosts={data?.hosts ?? []} isAdmin={isAdmin} onDone={closeEditor} />
        </Modal>
      )}
    </>
  );
}
