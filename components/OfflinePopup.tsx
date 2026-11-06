"use client";

import Link from "next/link";
import { useState } from "react";
import { fmtDuration } from "@/lib/format";
import type { LongOfflineFeed, LongOfflineHost } from "@/lib/types";
import { Modal } from "./forms";
import { StatusBadge } from "./StatusBadge";
import { readStored, useLiveData, writeStored } from "./useLiveData";

const SEEN_KEY = "vigil-offline-visti";

// Una caduta si riconosce da quando è iniziata: se l'host torna e ricade, il popup riappare
const fallKey = (host: LongOfflineHost) => `${host.id}:${host.since}`;

/** Su tutte le pagine. Questa lettura fa anche tornare al login quando la sessione si chiude. */
export function OfflinePopup() {
  const { data } = useLiveData<LongOfflineFeed>("/api/offline");
  const [seen, setSeen] = useState<string[]>(() => readStored<string[]>(SEEN_KEY, []));

  const hosts = data?.hosts ?? [];
  const unseen = hosts.filter((host) => !seen.includes(fallKey(host)));
  if (!data || unseen.length === 0) return null;

  function acknowledge() {
    const keys = hosts.map(fallKey);
    setSeen(keys);
    writeStored(SEEN_KEY, keys);
  }

  return (
    <Modal
      title={unseen.length === 1 ? "Dispositivo offline" : `${unseen.length} dispositivi offline`}
      onClose={acknowledge}
      className="offline-popup"
    >
      <ul className="offline-list">
        {unseen.map((host) => (
          <li key={host.id}>
            <StatusBadge status="offline" />
            <span className="offline-list__who">
              <Link className="cell-main" href={`/host/${host.id}`} onClick={acknowledge}>
                {host.name}
              </Link>
              <small>{[host.address, host.sector].filter(Boolean).join(" · ")}</small>
              {host.dependents > 0 && (
                <small>
                  {host.dependents === 1
                    ? "1 dispositivo collegato non raggiungibile"
                    : `${host.dependents} dispositivi collegati non raggiungibili`}
                </small>
              )}
              {host.ackBy && <small>In carico a {host.ackBy}</small>}
            </span>
            <span className="muted">da {fmtDuration(data.serverTime - host.since)}</span>
          </li>
        ))}
      </ul>
      <div className="form__actions">
        <button type="button" className="btn btn--primary" onClick={acknowledge}>
          Ho visto
        </button>
      </div>
    </Modal>
  );
}
