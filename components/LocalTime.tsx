"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Una data nell'ora di chi guarda. Il server non conosce il fuso del browser: se la scrivesse
 * lui, al caricamento React troverebbe un testo diverso. Compare quando la pagina è attiva.
 */
export function LocalTime({
  seconds,
  format,
}: {
  seconds: number | null | undefined;
  format: (seconds: number) => string;
}) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (seconds === null || seconds === undefined) return "—";
  return <time dateTime={new Date(seconds * 1000).toISOString()}>{ready ? format(seconds) : ""}</time>;
}
