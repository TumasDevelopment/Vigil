"use client";

import { useCallback, useEffect, useState } from "react";
import { REFRESH_SECONDS } from "@/lib/ranges";

export interface LiveState<T> {
  data: T | null;
  error: string | null;
  updatedAt: number | null;
  nextAt: number | null;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  /** Rilegge subito, per mostrare una modifica appena salvata */
  reload: () => void;
}

/**
 * Rilegge `url` ogni 10 secondi, o ogni `seconds`. Se una lettura fallisce i dati precedenti
 * restano a schermo e `error` segnala che non sono più aggiornati.
 */
export function useLiveData<T>(url: string, seconds = REFRESH_SECONDS): LiveState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((count) => count + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const schedule = () => {
      if (cancelled || paused) return;
      const delay = seconds * 1000;
      setNextAt(Date.now() + delay);
      timer = setTimeout(load, delay);
    };

    async function load() {
      // In una scheda nascosta non serve caricare il server: si riprende al ritorno
      if (document.hidden) {
        schedule();
        return;
      }
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as T;
        if (cancelled) return;
        setData(body);
        setUpdatedAt(Date.now());
        setError(null);
      } catch {
        if (cancelled) return;
        setError("Impossibile aggiornare i dati. I valori a schermo potrebbero non essere attuali.");
      }
      schedule();
    }

    const onVisible = () => {
      if (!document.hidden && !paused) {
        clearTimeout(timer);
        load();
      }
    };

    load();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, seconds, paused, reloads]);

  return { data, error, updatedAt, nextAt: paused ? null : nextAt, paused, setPaused, reload };
}

/** Valore ricordato nel browser, solo per comodità: se manca si usa il predefinito. */
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Finestra privata o spazio pieno: la preferenza vale solo per questa visita
  }
}
