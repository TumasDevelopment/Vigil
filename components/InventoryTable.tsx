"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtDay } from "@/lib/format";
import type { InventoryRow } from "@/lib/queries-enterprise";
import { DEVICE_TYPES, deviceLabel, NO_SECTOR_LABEL } from "@/lib/scope";
import { IconDownload } from "./icons";

const DAY = 86_400;

function Warranty({ day, today, warnDays }: { day: string | null; today: number; warnDays: number }) {
  if (!day) return <span className="muted">—</span>;
  const left = Math.floor((Date.parse(`${day}T23:59:59Z`) / 1000 - today) / DAY);
  const tone = left < 0 ? "offline" : left <= warnDays ? "unstable" : null;
  return tone ? (
    <span className={`badge badge--${tone}`}>{left < 0 ? `Scaduta ${fmtDay(day)}` : fmtDay(day)}</span>
  ) : (
    <span className="nowrap">{fmtDay(day)}</span>
  );
}

export function InventoryTable({
  rows,
  isAdmin,
  now,
  warrantyDays,
}: {
  rows: InventoryRow[];
  isAdmin: boolean;
  now: number;
  warrantyDays: number;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [missing, setMissing] = useState(false);

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("it");
    return rows.filter((row) => {
      if (type && row.type !== type) return false;
      if (missing && row.serial && row.manufacturer && row.model) return false;
      if (!needle) return true;
      return [row.name, row.address, row.sector, row.manufacturer, row.model, row.serial, row.firmware, row.location, row.owner, row.note]
        .some((value) => value?.toLocaleLowerCase("it").includes(needle));
    });
  }, [rows, query, type, missing]);

  const types = DEVICE_TYPES.filter((item) => rows.some((row) => row.type === item.key));

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h1>Inventario</h1>
          <p>Produttore, modello, seriale, posizione e garanzia di ogni dispositivo. Si compila nella scheda dell&apos;host.</p>
        </div>
        {isAdmin && (
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <a className="btn" href="/api/host.csv">
              <IconDownload />
              Esporta CSV
            </a>
          </div>
        )}
      </header>

      <div className="toolbar">
        <input
          className="input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cerca nome, seriale, modello, posizione…"
          aria-label="Cerca nell'inventario"
        />
        <select className="select" value={type} onChange={(event) => setType(event.target.value)} aria-label="Tipo">
          <option value="">Tutti i tipi</option>
          {types.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={missing} onChange={(event) => setMissing(event.target.checked)} />
          Solo schede incomplete
        </label>
        <span className="toolbar__end muted">
          {shown.length === rows.length ? `${rows.length} dispositivi` : `${shown.length} di ${rows.length}`}
        </span>
      </div>

      <section className="panel">
        {shown.length === 0 ? (
          <div className="empty">{rows.length === 0 ? "Nessun dispositivo." : "Nessun dispositivo con questi filtri."}</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Dispositivo</th>
                  <th>Produttore e modello</th>
                  <th>Seriale</th>
                  <th>Firmware</th>
                  <th>Posizione</th>
                  <th>Responsabile</th>
                  <th>Acquisto</th>
                  <th>Garanzia</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id} className={row.enabled ? undefined : "is-off"}>
                    <td>
                      <span className="cell-main">
                        <Link href={`/host/${row.id}`}>{row.name}</Link>
                      </span>
                      <span className="cell-sub">
                        {deviceLabel(row.type)} · {row.sector || NO_SECTOR_LABEL}
                      </span>
                    </td>
                    <td>
                      {[row.manufacturer, row.model].filter(Boolean).join(" ") || <span className="muted">—</span>}
                    </td>
                    <td className="mono">{row.serial ?? <span className="muted">—</span>}</td>
                    <td className="mono">{row.firmware ?? <span className="muted">—</span>}</td>
                    <td>{row.location ?? <span className="muted">—</span>}</td>
                    <td>{row.owner ?? <span className="muted">—</span>}</td>
                    <td className="nowrap">{row.purchasedOn ? fmtDay(row.purchasedOn) : <span className="muted">—</span>}</td>
                    <td>
                      <Warranty day={row.warrantyUntil} today={now} warnDays={warrantyDays} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
