"use client";

import { useEffect, useReducer } from "react";
import { fmtTime } from "@/lib/format";
import { RANGE_KEYS, RANGES, type RangeKey } from "@/lib/ranges";
import { ALL_FILTER } from "@/lib/scope";
import type { PingerStatus } from "@/lib/types";
import { IconPause, IconPlay, IconWarning } from "./icons";
import type { LiveState } from "./useLiveData";

export function RangePicker({ value, onChange }: { value: RangeKey; onChange: (range: RangeKey) => void }) {
  return (
    <div className="seg" role="group" aria-label="Periodo">
      {RANGE_KEYS.map((key) => (
        <button key={key} type="button" aria-pressed={key === value} onClick={() => onChange(key)}>
          {RANGES[key].label}
        </button>
      ))}
    </div>
  );
}

export function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string;
  options: { key: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select className="select" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value={ALL_FILTER}>{allLabel}</option>
      {options.map((option) => (
        <option key={option.key} value={option.key}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// Componente a parte: il conto alla rovescia ridisegna solo questo, non i grafici.
export function RefreshStatus<T>({ live }: { live: LiveState<T> }) {
  const [, tick] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = live.nextAt ? Math.max(0, Math.ceil((live.nextAt - Date.now()) / 1000)) : null;
  const dot = live.error ? "refresh__dot--error" : live.paused ? "refresh__dot--paused" : "";

  let text = "Caricamento…";
  if (live.updatedAt) {
    const when = fmtTime(live.updatedAt / 1000);
    text = live.paused ? `In pausa · dati delle ${when}` : `Aggiornato alle ${when} · ${remaining ?? 0} s`;
  }

  return (
    <span className="refresh" role="status">
      <span className={`refresh__dot ${dot}`} aria-hidden="true" />
      {text}
      <button
        type="button"
        className="btn btn--small"
        onClick={() => live.setPaused(!live.paused)}
        aria-label={live.paused ? "Riprendi aggiornamento" : "Metti in pausa aggiornamento"}
      >
        {live.paused ? <IconPlay /> : <IconPause />}
        {live.paused ? "Riprendi" : "Pausa"}
      </button>
    </span>
  );
}

export function HealthBanner({ error, pinger }: { error: string | null; pinger?: PingerStatus }) {
  let message = error;
  if (!message && pinger && !pinger.healthy) {
    message = pinger.lastBeat
      ? `Il servizio di ping non risponde dalle ${fmtTime(pinger.lastBeat)}: gli stati non sono attendibili.`
      : "Il servizio di ping non è ancora partito: nessuno stato disponibile.";
  }
  if (!message) return null;

  return (
    <div className="banner" role="alert">
      <IconWarning />
      <span>{message}</span>
    </div>
  );
}
