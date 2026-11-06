"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { fmtAxisTime, fmtDateTime, fmtTicks } from "@/lib/format";
import { CHART_COLORS, withAlpha } from "@/lib/palette";

export interface ChartSeries {
  label: string;
  color: string;
  values: (number | null)[];
  /** "bound" è un limite della fascia min-max: non ha linea propria */
  kind?: "line" | "bars" | "bound";
}

interface Props {
  t: number[];
  series: ChartSeries[];
  rangeSeconds: number;
  /** Valori nel tooltip */
  format: (value: number) => string;
  /** Unità sulle tacche dell'asse */
  unit: string;
  ariaLabel: string;
  height?: number;
  yMax?: number;
  /** Colora di una tinta leggera l'area sotto la linea (grafici a serie singola) */
  area?: boolean;
}

const AXIS_FONT = '12px system-ui, -apple-system, "Segoe UI", sans-serif';

function tooltipPlugin(format: () => (value: number) => string, series: () => ChartSeries[]) {
  let tip: HTMLDivElement;

  return {
    hooks: {
      init: (plot: uPlot) => {
        tip = document.createElement("div");
        tip.className = "chart-tip";
        tip.hidden = true;
        plot.over.parentElement?.appendChild(tip);
      },
      setCursor: (plot: uPlot) => {
        const { idx, left, top } = plot.cursor;
        if (idx === null || idx === undefined || left === undefined || top === undefined || left < 0) {
          tip.hidden = true;
          return;
        }

        // Le etichette sono nomi inseriti dagli utenti: solo textContent, mai innerHTML
        tip.replaceChildren();
        const time = document.createElement("div");
        time.className = "chart-tip__time";
        time.textContent = fmtDateTime(plot.data[0][idx]);
        tip.appendChild(time);

        series().forEach((entry, index) => {
          const value = plot.data[index + 1]?.[idx];
          const row = document.createElement("div");
          row.className = "chart-tip__row";

          const key = document.createElement("span");
          key.className = "chart-tip__key";
          key.style.background = entry.color;

          const shown = document.createElement("span");
          shown.className = "chart-tip__value";
          shown.textContent = value === null || value === undefined ? "—" : format()(value);

          const name = document.createElement("span");
          name.className = "chart-tip__name";
          name.textContent = entry.label;

          row.append(key, shown, name);
          tip.appendChild(row);
        });

        tip.hidden = false;
        const width = tip.offsetWidth;
        const x = plot.over.offsetLeft + left;
        const fitsRight = x + width + 16 < plot.over.parentElement!.clientWidth;
        tip.style.left = `${fitsRight ? x + 14 : x - width - 14}px`;
        tip.style.top = `${Math.max(0, plot.over.offsetTop + top - tip.offsetHeight / 2)}px`;
      },
    },
  };
}

export function TimeSeriesChart({ t, series, rangeSeconds, format, unit, ariaLabel, height = 260, yMax, area }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  const latest = useRef({ series, format, t });
  latest.current = { series, format, t };

  const shape = series.map((entry) => `${entry.label}|${entry.color}|${entry.kind ?? "line"}`).join("~");

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const current = latest.current;
    const bars = uPlot.paths.bars?.({ size: [0.7, 24], radius: 0.15 });

    const boundIndexes = current.series.flatMap((entry, index) => (entry.kind === "bound" ? [index + 1] : []));
    const bandColor = current.series.find((entry) => entry.kind === "bound")?.color;

    const options: uPlot.Options = {
      width: element.clientWidth,
      height,
      legend: { show: false },
      cursor: {
        y: false,
        drag: { x: false, y: false },
        points: { size: 8, width: 2, stroke: CHART_COLORS.surface },
      },
      scales: {
        x: { time: true },
        y: {
          range: (_plot, _min, max) => {
            if (yMax !== undefined) return [0, yMax];
            return [0, max !== null && max > 0 ? max * 1.15 : 1];
          },
        },
      },
      series: [
        {},
        ...current.series.map((entry): uPlot.Series => {
          if (entry.kind === "bound") {
            return { label: entry.label, stroke: "transparent", width: 0, points: { show: false } };
          }
          if (entry.kind === "bars") {
            return {
              label: entry.label,
              stroke: entry.color,
              fill: entry.color,
              width: 0,
              paths: bars,
              points: { show: false },
            };
          }
          return {
            label: entry.label,
            stroke: entry.color,
            width: 2,
            fill: area ? withAlpha(entry.color, 0.1) : undefined,
            points: { show: false },
            spanGaps: false,
          };
        }),
      ],
      bands:
        boundIndexes.length === 2 && bandColor
          ? [{ series: [boundIndexes[0], boundIndexes[1]] as [number, number], fill: withAlpha(bandColor, 0.16) }]
          : undefined,
      axes: [
        {
          stroke: CHART_COLORS.axis,
          font: AXIS_FONT,
          space: 86,
          grid: { show: false },
          ticks: { stroke: CHART_COLORS.baseline, width: 1, size: 4 },
          values: (_plot, splits) => splits.map((value) => fmtAxisTime(value, rangeSeconds)),
        },
        {
          stroke: CHART_COLORS.axis,
          font: AXIS_FONT,
          size: 62,
          grid: { stroke: CHART_COLORS.grid, width: 1 },
          ticks: { show: false },
          values: (_plot, splits) => fmtTicks(splits, unit),
        },
      ],
      plugins: [
        tooltipPlugin(
          () => latest.current.format,
          () => latest.current.series,
        ),
      ],
    };

    const instance = new uPlot(options, [current.t, ...current.series.map((entry) => entry.values)], element);
    plot.current = instance;

    const observer = new ResizeObserver(() => {
      instance.setSize({ width: element.clientWidth, height });
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      instance.destroy();
      plot.current = null;
    };
  }, [shape, rangeSeconds, height, yMax, area, unit]);

  useEffect(() => {
    plot.current?.setData([t, ...series.map((entry) => entry.values)]);
  }, [t, series]);

  return <div ref={container} className="chart" style={{ height }} role="img" aria-label={ariaLabel} />;
}
