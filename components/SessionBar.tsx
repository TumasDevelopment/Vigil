"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IconMaximize } from "./icons";

// Basta un segnale al minuto: la sessione si chiude dopo un'ora
const ACTIVITY_EVERY_MS = 60_000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel"] as const;

interface Crumb {
  label: string;
  href?: string;
}

const PAGES: Record<string, Crumb[]> = {
  "/": [{ label: "Panoramica" }],
  "/settori": [{ label: "Per settore" }],
  "/tipi": [{ label: "Per tipo" }],
  "/servizi": [{ label: "Servizi" }],
  "/eventi": [{ label: "Eventi" }],
  "/planimetrie": [{ label: "Planimetrie" }],
  "/viste": [{ label: "Viste salvate" }],
  "/account": [{ label: "Il mio account" }],
  "/admin/host": [{ label: "Amministrazione" }, { label: "Host" }],
  "/admin/ricerca": [{ label: "Amministrazione" }, { label: "Ricerca rete" }],
  "/admin/manutenzioni": [{ label: "Amministrazione" }, { label: "Manutenzioni" }],
  "/admin/utenti": [{ label: "Amministrazione" }, { label: "Utenti" }],
  "/admin/server": [{ label: "Amministrazione" }, { label: "Server" }],
  "/admin/sistema": [{ label: "Amministrazione" }, { label: "Sistema" }],
};

function crumbsFor(pathname: string): Crumb[] {
  if (pathname.startsWith("/host/")) return [{ label: "Panoramica", href: "/" }, { label: "Dettaglio host" }];
  if (pathname.startsWith("/vista/")) return [{ label: "Viste salvate", href: "/viste" }, { label: "Vista" }];
  if (pathname.startsWith("/planimetrie/")) {
    return [{ label: "Planimetrie", href: "/planimetrie" }, { label: "Planimetria" }];
  }
  return PAGES[pathname] ?? [];
}

function Crumbs() {
  const crumbs = crumbsFor(usePathname());
  return (
    <nav aria-label="Percorso">
      <ol className="crumbs">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={crumb.label}>
              {crumb.href ? (
                <Link href={crumb.href}>{crumb.label}</Link>
              ) : (
                <span aria-current={last ? "page" : undefined}>{crumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

async function saveKiosk(on: boolean) {
  const response = await fetch("/api/sessione", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kiosk: on }),
  }).catch(() => null);
  if (response?.status === 401) window.location.href = "/login";
  return response?.ok === true;
}

/** Il browser accetta lo schermo intero solo dentro un clic. Su iPhone non esiste. */
function enterFullscreen() {
  return document.documentElement.requestFullscreen?.().catch(() => undefined);
}

function exitFullscreen() {
  return document.fullscreenElement ? document.exitFullscreen().catch(() => undefined) : undefined;
}

export function SessionBar({ kiosk: savedKiosk }: { kiosk: boolean }) {
  const [kiosk, setKiosk] = useState(savedKiosk);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement !== null);
    setCanFullscreen(document.fullscreenEnabled === true);
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // L'aggiornamento automatico dei dati non conta: la sessione resta viva solo se c'è una persona
  useEffect(() => {
    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last < ACTIVITY_EVERY_MS) return;
      last = now;
      fetch("/api/sessione", { method: "POST" }).catch(() => undefined);
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true });
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
    };
  }, []);

  async function startKiosk() {
    const entering = enterFullscreen();
    const saved = await saveKiosk(true);
    await entering;
    if (saved) setKiosk(true);
    else await exitFullscreen();
  }

  async function stopKiosk() {
    if (!(await saveKiosk(false))) return;
    setKiosk(false);
    await exitFullscreen();
  }

  return (
    <div className="topbar">
      <Crumbs />
      <div className="topbar__actions">
        {kiosk && canFullscreen && !fullscreen && (
          <button type="button" className="btn btn--small" onClick={enterFullscreen}>
            <IconMaximize />
            Schermo intero
          </button>
        )}
        {kiosk ? (
          <button type="button" className="btn btn--small" onClick={stopKiosk}>
            Esci dal chiosco
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={startKiosk}
            aria-label="Modalità chiosco"
            title="Schermo intero, e la sessione resta aperta anche senza attività"
          >
            <IconMaximize />
            <span className="btn__label">Modalità chiosco</span>
          </button>
        )}
      </div>
    </div>
  );
}
