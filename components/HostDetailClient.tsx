"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtDateTime, fmtDuration, fmtMs, fmtPct, fmtUntil, fmtUptime } from "@/lib/format";
import { SERIES_COLORS } from "@/lib/palette";
import { RANGES, type RangeKey } from "@/lib/ranges";
import { deviceLabel } from "@/lib/scope";
import type { HostDetailData } from "@/lib/types";
import { IconWarning } from "./icons";
import { OutageTable } from "./OutageTable";
import { ServiceTable } from "./ServiceTable";
import { StateTimeline, TimelineLegend } from "./StateTimeline";
import { StatusBadge } from "./StatusBadge";
import { TimeSeriesChart, type ChartSeries } from "./TimeSeriesChart";
import { HealthBanner, RangePicker, RefreshStatus } from "./Toolbar";
import { useLiveData } from "./useLiveData";

const LATENCY_COLOR = SERIES_COLORS[0];
const LOSS_COLOR = SERIES_COLORS[1];

const formatLoss = (value: number) => fmtPct(value, 0);

export function HostDetailClient({
  hostId,
  initialRange,
  ackAs,
}: {
  hostId: number;
  initialRange: RangeKey;
  ackAs: string | null;
}) {
  const [range, setRange] = useState(initialRange);
  const live = useLiveData<HostDetailData>(`/api/host/${hostId}?range=${range}`);
  const data = live.data;

  function changeRange(next: RangeKey) {
    setRange(next);
    window.history.replaceState(null, "", `?range=${next}`);
  }

  const latencySeries = useMemo<ChartSeries[]>(
    () =>
      data
        ? [
            { label: "Massima", color: LATENCY_COLOR, values: data.max, kind: "bound" },
            { label: "Media", color: LATENCY_COLOR, values: data.avg },
            { label: "Minima", color: LATENCY_COLOR, values: data.min, kind: "bound" },
          ]
        : [],
    [data],
  );

  const lossSeries = useMemo<ChartSeries[]>(
    () => (data ? [{ label: "Perdita", color: LOSS_COLOR, values: data.lossSeries, kind: "bars" }] : []),
    [data],
  );

  const timelineRows = useMemo(
    () => (data ? [{ id: data.host.id, name: data.host.name, up: data.up, spans: data.maintenance }] : []),
    [data],
  );

  const refetching = data !== null && data.range !== range;
  const rangeSeconds = RANGES[data?.range ?? range].seconds;

  return (
    <>
      <Link className="back-link" href={`/?range=${range}`}>
        ← Panoramica
      </Link>
      <header className="page-head">
        <div>
          <div className="host-title">
            <h1>{data?.host.name ?? "Host"}</h1>
            {data && <StatusBadge status={data.host.status} />}
          </div>
          {data && (
            <p>
              {data.host.address} · {deviceLabel(data.host.type)}
              {data.host.sector ? ` · ${data.host.sector}` : ""}
              {data.host.pingEnabled ? "" : " · senza ping"}
              {data.host.parentId !== null && (
                <>
                  {" · collegato a "}
                  <Link href={`/host/${data.host.parentId}?range=${range}`}>{data.host.parentName}</Link>
                </>
              )}
              {data.host.maintenanceUntil !== null
                ? ` · ${fmtUntil(data.host.maintenanceUntil, data.serverTime)}`
                : data.host.since && data.host.status !== "unknown" && data.host.status !== "paused"
                  ? ` · in questo stato da ${fmtDuration(data.serverTime - data.host.since)}`
                  : ""}
            </p>
          )}
          {data?.host.reason && (
            <p className="reason">
              <IconWarning />
              {data.host.reason}
            </p>
          )}
        </div>
      </header>

      <HealthBanner error={live.error} pinger={data?.pinger} />

      <div className="toolbar">
        <RangePicker value={range} onChange={changeRange} />
        <div className="toolbar__end">
          <RefreshStatus live={live} />
        </div>
      </div>

      {data && (
        <div className={`stack ${refetching ? "is-refetching" : ""}`}>
          <div className="tiles">
            <div className="tile">
              <div className="tile__label">Latenza attuale</div>
              <div className="tile__value">
                {data.host.status === "offline" || data.host.status === "unreachable" ? "—" : fmtMs(data.host.rtt)}
              </div>
              {data.host.latencyWarn !== null && (
                <div className="tile__note">Instabile oltre {fmtMs(data.host.latencyWarn)}</div>
              )}
            </div>
            <div className="tile">
              <div className="tile__label">Media</div>
              <div className="tile__value">{fmtMs(data.stats.avgRtt)}</div>
              <div className="tile__note">
                Min {fmtMs(data.stats.minRtt)} · Max {fmtMs(data.stats.maxRtt)}
              </div>
            </div>
            <div className="tile">
              <div className="tile__label">95° percentile</div>
              <div className="tile__value">{fmtMs(data.stats.p95Rtt)}</div>
              <div className="tile__note">Il 95% dei ping è sotto questo valore</div>
            </div>
            <div className="tile">
              <div className="tile__label">Perdita pacchetti</div>
              <div className="tile__value">{fmtPct(data.stats.loss, 1)}</div>
              {data.host.lossWarn !== null && (
                <div className="tile__note">Instabile oltre {fmtPct(data.host.lossWarn, 0)}</div>
              )}
            </div>
            <div className="tile">
              <div className="tile__label">Disponibilità</div>
              <div className="tile__value">{fmtUptime(data.stats.uptime)}</div>
              <div className="tile__note">
                {data.stats.outageCount === 1 ? "1 interruzione" : `${data.stats.outageCount} interruzioni`} ·{" "}
                {fmtDuration(data.stats.downtimeSeconds)} offline
              </div>
            </div>
          </div>

          {data.services.length > 0 && (
            <section className="panel">
              <div className="panel__head">
                <h2 className="panel__title">Servizi</h2>
                <Link className="panel__link" href="/servizi">
                  Tutti i servizi
                </Link>
              </div>
              <ServiceTable services={data.services} now={data.serverTime} showHost={false} />
            </section>
          )}

          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Timeline di stato</h2>
              <TimelineLegend />
            </div>
            <StateTimeline
              rows={timelineRows}
              t={data.t}
              bucketSeconds={data.bucketSeconds}
              rangeSeconds={rangeSeconds}
              rangeQuery={range}
              showLabels={false}
            />
          </section>

          <div className="grid-2 grid-2--even">
            <section className="panel">
              <div className="panel__head">
                <div>
                  <h2 className="panel__title">Latenza</h2>
                  <p className="panel__sub">Media per intervallo</p>
                </div>
                <div className="legend" style={{ marginBottom: 0 }}>
                  <span className="legend__item">
                    <span className="legend__key" style={{ background: LATENCY_COLOR }} />
                    Media
                  </span>
                  <span className="legend__item">
                    <span
                      className="legend__key legend__key--band"
                      style={{ background: LATENCY_COLOR, opacity: 0.35 }}
                    />
                    Da minima a massima
                  </span>
                </div>
              </div>
              <TimeSeriesChart
                t={data.t}
                series={latencySeries}
                rangeSeconds={rangeSeconds}
                format={fmtMs}
                unit="ms"
                ariaLabel="Latenza nel tempo; i valori sono nella tabella dati"
              />
            </section>

            <section className="panel">
              <div className="panel__head">
                <div>
                  <h2 className="panel__title">Perdita pacchetti</h2>
                  <p className="panel__sub">Percentuale per intervallo</p>
                </div>
              </div>
              <TimeSeriesChart
                t={data.t}
                series={lossSeries}
                rangeSeconds={rangeSeconds}
                format={formatLoss}
                unit="%"
                yMax={100}
                ariaLabel="Perdita pacchetti nel tempo; i valori sono nella tabella dati"
              />
            </section>
          </div>

          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Interruzioni</h2>
            </div>
            <OutageTable
              outages={data.outages}
              now={data.serverTime}
              range={range}
              showHost={false}
              ackAs={ackAs}
              onSaved={live.reload}
            />
          </section>

          <section className="panel">
            <details className="data-table">
              <summary>Tabella dati dei grafici</summary>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ora</th>
                      <th className="num">Minima</th>
                      <th className="num">Media</th>
                      <th className="num">Massima</th>
                      <th className="num">Perdita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.t
                      .map((time, index) => ({ time, index }))
                      .filter(({ index }) => data.up[index] !== null)
                      .reverse()
                      .map(({ time, index }) => (
                        <tr key={time}>
                          <td className="muted">{fmtDateTime(time)}</td>
                          <td className="num">{fmtMs(data.min[index])}</td>
                          <td className="num">{fmtMs(data.avg[index])}</td>
                          <td className="num">{fmtMs(data.max[index])}</td>
                          <td className="num">{fmtPct(data.lossSeries[index], 1)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        </div>
      )}
    </>
  );
}
