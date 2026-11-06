"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { fmtAxisTime, fmtDateTime, fmtUptime } from "@/lib/format";
import { STATE_COLORS } from "@/lib/palette";
import type { MaintenanceSpan } from "@/lib/types";

export interface TimelineRow {
  /** Numero: una riga per host, con il link. Testo: una riga per gruppo. */
  id: number | string;
  name: string;
  up: (number | null)[];
  /** Le manutenzioni: i loro ping non contano, quindi le celle senza dati vanno spiegate */
  spans?: MaintenanceSpan[];
}

interface Props {
  rows: TimelineRow[];
  t: number[];
  bucketSeconds: number;
  rangeSeconds: number;
  rangeQuery: string;
  showLabels?: boolean;
}

const ROW_HEIGHT = 22;
const BAR_HEIGHT = 14;
const GAP = 2;

type Level = "online" | "partial" | "offline" | "maintenance" | "nodata";

function levelOf(value: number | null): Level {
  if (value === null) return "nodata";
  if (value >= 1) return "online";
  return value <= 0 ? "offline" : "partial";
}

function cellLevel(row: TimelineRow, column: number, t: number[], bucketSeconds: number): Level {
  const value = row.up[column] ?? null;
  const planned =
    value === null && row.spans?.some(([start, end]) => start < t[column] + bucketSeconds && end > t[column]);
  return planned ? "maintenance" : levelOf(value);
}

const LEVEL_LABEL: Record<Level, string> = {
  online: "Online",
  partial: "Instabile",
  offline: "Offline",
  maintenance: "In manutenzione",
  nodata: "Nessun dato",
};

function draw(canvas: HTMLCanvasElement, rows: TimelineRow[], t: number[], bucketSeconds: number) {
  const columns = t.length;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = rows.length * ROW_HEIGHT;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);

  const context = canvas.getContext("2d");
  if (!context || columns === 0) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const cell = width / columns;

  rows.forEach((row, rowIndex) => {
    const y = rowIndex * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;

    // Celle consecutive nello stesso stato diventano una sola barra
    let start = 0;
    for (let column = 1; column <= columns; column++) {
      const previous = cellLevel(row, column - 1, t, bucketSeconds);
      if (column < columns && cellLevel(row, column, t, bucketSeconds) === previous) continue;

      const x = start * cell;
      const barWidth = Math.max(1, (column - start) * cell - GAP);
      context.fillStyle = STATE_COLORS[previous];
      context.beginPath();
      context.roundRect(x, y, barWidth, BAR_HEIGHT, Math.min(3, barWidth / 2));
      context.fill();
      start = column;
    }
  });
}

export function StateTimeline({ rows, t, bucketSeconds, rangeSeconds, rangeQuery, showLabels = true }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{
    clientX: number;
    clientY: number;
    row: number;
    column: number;
    cellLeft: number;
    cellWidth: number;
  } | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    draw(element, rows, t, bucketSeconds);

    const observer = new ResizeObserver(() => draw(element, rows, t, bucketSeconds));
    observer.observe(element);
    return () => observer.disconnect();
  }, [rows, t, bucketSeconds]);

  function onMove(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const cellWidth = box.width / Math.max(1, t.length);
    const column = Math.min(t.length - 1, Math.max(0, Math.floor((event.clientX - box.left) / cellWidth)));
    const row = Math.min(rows.length - 1, Math.max(0, Math.floor((event.clientY - box.top) / ROW_HEIGHT)));
    setHover({
      clientX: event.clientX,
      clientY: event.clientY,
      row,
      column,
      cellLeft: column * cellWidth,
      cellWidth,
    });
  }

  const ticks = t.length > 1 ? [0, 0.25, 0.5, 0.75, 1].map((part) => t[Math.round(part * (t.length - 1))]) : [];
  const hovered = hover ? rows[hover.row] : null;
  const hoveredValue = hover && hovered ? (hovered.up[hover.column] ?? null) : null;

  return (
    <>
      <div className="timeline" style={showLabels ? undefined : { gridTemplateColumns: "minmax(0, 1fr)" }}>
        {showLabels && (
          <div className="timeline__labels">
            {rows.map((row) =>
              typeof row.id === "number" ? (
                <Link key={row.id} href={`/host/${row.id}?range=${rangeQuery}`} title={row.name}>
                  {row.name}
                </Link>
              ) : (
                <span key={row.id} title={row.name}>
                  {row.name}
                </span>
              ),
            )}
          </div>
        )}
        <div className="timeline__plot">
          <canvas
            ref={canvas}
            style={{ height: rows.length * ROW_HEIGHT }}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            role="img"
            aria-label="Timeline di stato: online, instabile, offline, in manutenzione o nessun dato per ogni intervallo"
          />
          {hover && (
            <div
              className="timeline__hover"
              style={{
                left: hover.cellLeft,
                width: Math.max(3, hover.cellWidth - GAP),
                top: hover.row * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2,
                height: BAR_HEIGHT,
              }}
            />
          )}
        </div>
        <div className="timeline__axis" style={showLabels ? undefined : { gridColumn: 1 }}>
          {ticks.map((value) => (
            <span key={value}>{fmtAxisTime(value, rangeSeconds)}</span>
          ))}
        </div>
      </div>

      {hover && hovered && (
        <div
          className="float-tip"
          style={{
            left: Math.min(hover.clientX + 14, window.innerWidth - 240),
            top: hover.clientY + 14,
          }}
        >
          <strong>{hoveredValue === null ? "—" : fmtUptime(hoveredValue * 100)}</strong>
          <span>
            {LEVEL_LABEL[cellLevel(hovered, hover.column, t, bucketSeconds)]} · {hovered.name}
          </span>
          <br />
          <span>
            {fmtDateTime(t[hover.column])} · {bucketSeconds < 60 ? `${bucketSeconds} s` : `${bucketSeconds / 60} min`}
          </span>
        </div>
      )}
    </>
  );
}

export function TimelineLegend() {
  const items: [string, string][] = [
    ["Online", STATE_COLORS.online],
    ["Instabile", STATE_COLORS.partial],
    ["Offline", STATE_COLORS.offline],
    ["In manutenzione", STATE_COLORS.maintenance],
    ["Nessun dato", STATE_COLORS.nodata],
  ];
  return (
    <div className="legend" style={{ marginBottom: 0 }}>
      {items.map(([label, color]) => (
        <span key={label} className="legend__item">
          <span className="legend__swatch" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}
