"use client";

import { useMemo, useState } from "react";
import { fmtBytes, fmtDateTime, fmtDuration, fmtPct, fmtTime } from "@/lib/format";
import { SERIES_COLORS } from "@/lib/palette";
import { RANGES, type RangeKey } from "@/lib/ranges";
import type { ServerData, ServerPort, ServerProcess } from "@/lib/types";
import { IconOffline, IconOnline, IconWarning } from "./icons";
import { TimeSeriesChart, type ChartSeries } from "./TimeSeriesChart";
import { RangePicker, RefreshStatus } from "./Toolbar";
import { useLiveData } from "./useLiveData";

const formatPercent = (value: number) => fmtPct(value, 0);
const share = (used: number, total: number) => (total > 0 ? (100 * used) / total : null);

function ProcessRow({ process, now }: { process: ServerProcess; now: number }) {
  const online = process.status === "online";
  return (
    <tr>
      <td>
        <span className={`badge badge--${online ? "online" : "offline"}`}>
          {online ? <IconOnline /> : <IconOffline />}
          {online ? "Online" : process.status}
        </span>
      </td>
      <td>
        <span className="cell-main">{process.name}</span>
      </td>
      <td className="num">{fmtPct(process.cpu, 0)}</td>
      <td className="num">{fmtBytes(process.memory)}</td>
      <td className="num">{process.restarts}</td>
      <td className="num muted">{online && process.startedAt ? fmtDuration(now - process.startedAt) : "—"}</td>
    </tr>
  );
}

function PortRow({ port }: { port: ServerPort }) {
  return (
    <tr>
      <td>
        <span className={`badge badge--${port.ok ? "online" : "offline"}`}>
          {port.ok ? <IconOnline /> : <IconOffline />}
          {port.ok ? "Risponde" : "Non funziona"}
        </span>
      </td>
      <td>
        <span className="cell-main">{port.port}</span>
      </td>
      <td className="num">{port.upstream}</td>
      <td className="muted">{port.detail}</td>
    </tr>
  );
}

export function ServerClient({ initialRange }: { initialRange: RangeKey }) {
  const [range, setRange] = useState(initialRange);
  const live = useLiveData<ServerData>(`/api/server?range=${range}`);
  const data = live.data;
  const current = data?.current ?? null;

  const series = useMemo<ChartSeries[]>(
    () =>
      data
        ? [
            { label: "CPU", color: SERIES_COLORS[0], values: data.cpu },
            { label: "RAM", color: SERIES_COLORS[1], values: data.mem },
            { label: "Swap", color: SERIES_COLORS[2], values: data.swap },
            { label: "Disco", color: SERIES_COLORS[3], values: data.disk },
          ]
        : [],
    [data],
  );

  const failedPorts = current?.ports.filter((port) => !port.ok).length ?? 0;
  const processes = current?.processes ?? null;
  const stoppedProcesses = processes?.filter((process) => process.status !== "online").length ?? 0;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Server</h1>
          <p>Salute del server: risorse, processi e porte. Si aggiorna ogni minuto.</p>
        </div>
      </header>

      {live.error && (
        <div className="banner" role="alert">
          <IconWarning />
          <span>{live.error}</span>
        </div>
      )}
      {data?.stale && (
        <div className="banner" role="alert">
          <IconWarning />
          <span>
            {data.sampledAt
              ? `Ultimo campione alle ${fmtTime(data.sampledAt)}: i valori non sono aggiornati.`
              : "Nessun campione ancora disponibile."}
          </span>
        </div>
      )}

      <div className="toolbar">
        <RangePicker
          value={range}
          onChange={(next) => {
            setRange(next);
            window.history.replaceState(null, "", `?range=${next}`);
          }}
        />
        <div className="toolbar__end">
          <RefreshStatus live={live} />
        </div>
      </div>

      {data && current && (
        <div className="stack">
          <div className="tiles">
            <div className="tile">
              <div className="tile__label">CPU</div>
              <div className="tile__value">{fmtPct(current.cpu, 0)}</div>
              <div className="tile__note">
                {current.cores} core · carico {current.load[0].toLocaleString("it-IT", { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="tile">
              <div className="tile__label">RAM</div>
              <div className="tile__value">{fmtPct(share(current.memUsed, current.memTotal), 0)}</div>
              <div className="tile__note">
                {fmtBytes(current.memUsed)} su {fmtBytes(current.memTotal)}
              </div>
            </div>
            <div className="tile">
              <div className="tile__label">Swap</div>
              <div className="tile__value">{fmtPct(share(current.swapUsed, current.swapTotal), 0)}</div>
              <div className="tile__note">
                {fmtBytes(current.swapUsed)} su {fmtBytes(current.swapTotal)}
              </div>
            </div>
            <div className="tile">
              <div className="tile__label">Disco</div>
              <div className="tile__value">{fmtPct(share(current.diskUsed, current.diskTotal), 0)}</div>
              <div className="tile__note">
                {fmtBytes(current.diskUsed)} su {fmtBytes(current.diskTotal)}
              </div>
            </div>
            <div className="tile">
              <div className="tile__label">Acceso da</div>
              <div className="tile__value">{fmtDuration(current.uptime)}</div>
            </div>
          </div>

          <section className="panel">
            <div className="panel__head">
              <div>
                <h2 className="panel__title">Uso delle risorse</h2>
                <p className="panel__sub">Percentuale per intervallo</p>
              </div>
              <div className="legend" style={{ marginBottom: 0 }}>
                {series.map((item) => (
                  <span key={item.label} className="legend__item">
                    <span className="legend__key" style={{ background: item.color }} />
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
            <TimeSeriesChart
              t={data.t}
              series={series}
              rangeSeconds={RANGES[data.range].seconds}
              format={formatPercent}
              unit="%"
              yMax={100}
              ariaLabel="Uso di CPU, RAM, swap e disco nel tempo; i valori sono nella tabella dati"
            />
          </section>

          <div className="grid-2 grid-2--even">
            <section className="panel">
              <div className="panel__head">
                <div>
                  <h2 className="panel__title">Processi PM2</h2>
                  <p className="panel__sub">
                    {processes === null
                      ? "Elenco non disponibile"
                      : stoppedProcesses > 0
                        ? `${stoppedProcesses} fermi su ${processes.length}`
                        : `Tutti i ${processes.length} processi sono attivi`}
                  </p>
                </div>
              </div>
              {processes !== null && (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Stato</th>
                        <th>Nome</th>
                        <th className="num">CPU</th>
                        <th className="num">RAM</th>
                        <th className="num">Riavvii</th>
                        <th className="num">Attivo da</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processes.map((process) => (
                        <ProcessRow key={process.name} process={process} now={data.serverTime} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel__head">
                <div>
                  <h2 className="panel__title">Porte pubblicate</h2>
                  <p className="panel__sub">
                    {!current.nginxReadable
                      ? "Configurazione di nginx non leggibile"
                      : failedPorts > 0
                        ? `${failedPorts} non funzionano su ${current.ports.length}`
                        : `Tutte le ${current.ports.length} porte rispondono`}
                  </p>
                </div>
              </div>
              {current.ports.length > 0 && (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Stato</th>
                        <th>Porta</th>
                        <th className="num">Interna</th>
                        <th>Dettaglio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.ports.map((port) => (
                        <PortRow key={port.port} port={port} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <section className="panel">
            <details className="data-table">
              <summary>Tabella dati del grafico</summary>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ora</th>
                      {series.map((item) => (
                        <th key={item.label} className="num">
                          {item.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.t
                      .map((time, index) => ({ time, index }))
                      .filter(({ index }) => data.cpu[index] !== null || data.mem[index] !== null)
                      .reverse()
                      .map(({ time, index }) => (
                        <tr key={time}>
                          <td className="muted">{fmtDateTime(time)}</td>
                          {series.map((item) => (
                            <td key={item.label} className="num">
                              {fmtPct(item.values[index], 0)}
                            </td>
                          ))}
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
