"use client";

import { useSyncExternalStore } from "react";
import { fmtDate, fmtDateTime, fmtFullDate, fmtTime } from "@/lib/format";

const subscribe = () => () => {};

/** Per nome, così si può usare anche da un server component (una funzione non attraversa il confine). */
const NAMED = { date: fmtDate, dateTime: fmtDateTime, time: fmtTime, full: (seconds: number) => fmtFullDate(seconds) } as const;

/**
 * Una data nell'ora di chi guarda. Il server non conosce il fuso del browser: se la scrivesse
 * lui, al caricamento React troverebbe un testo diverso. Compare quando la pagina è attiva.
 */
export function LocalTime({
  seconds,
  format,
}: {
  seconds: number | null | undefined;
  format: ((seconds: number) => string) | keyof typeof NAMED;
}) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (seconds === null || seconds === undefined) return "—";
  return <time dateTime={new Date(seconds * 1000).toISOString()}>{ready ? (typeof format === "string" ? NAMED[format] : format)(seconds) : ""}</time>;
}
