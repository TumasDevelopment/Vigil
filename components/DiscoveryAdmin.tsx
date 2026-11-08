"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { addDiscoveredHostsAction, cancelDiscoveryAction, startDiscoveryAction } from "@/lib/actions";
import { fmtCount, fmtDateTime, fmtDuration, fmtMs } from "@/lib/format";
import { REFRESH_SECONDS } from "@/lib/ranges";
import { DEVICE_TYPES } from "@/lib/scope";
import { addressList, parseSubnet, scanSeconds } from "@/lib/subnet.mjs";
import type { DiscoveryItem, DiscoveryScan } from "@/lib/types";
import { SubmitButton, useFormAction } from "./forms";
import { useLiveData } from "./useLiveData";

const SCANNING_SECONDS = 2;

const PORT_NAMES: Record<number, string> = {
  22: "SSH",
  80: "HTTP",
  443: "HTTPS",
  445: "Condivisioni",
  554: "Video",
  631: "Stampa",
  3389: "Desktop remoto",
  9100: "Stampa",
};

const isActive = (scan: DiscoveryScan | null) => scan?.status === "queued" || scan?.status === "running";

const hostCount = (count: number) => (count === 1 ? "1 dispositivo" : `${count} dispositivi`);

/** Come verrà tenuto d'occhio: senza ping un host aggiunto così risulterebbe subito offline. */
function reachText(item: DiscoveryItem) {
  if (item.rtt !== null) return fmtMs(item.rtt);
  if (item.ports.length > 0) return `Niente ping: si controlla la porta ${item.ports[0]}`;
  return "Visto solo in rete locale: serve un controllo";
}

/** "254 indirizzi, circa 11 s": chi scrive una /8 deve sapere prima che durerà giorni. */
function estimateText(input: string) {
  const subnet = parseSubnet(input);
  if (subnet.error !== undefined) return null;
  const count = addressList(subnet).length;
  return `${fmtCount(count)} ${count === 1 ? "indirizzo" : "indirizzi"}, circa ${fmtDuration(scanSeconds(count))}`;
}

function SearchForm({ suggestion, busy, onStarted }: { suggestion: string; busy: boolean; onStarted: () => void }) {
  const { state, pending, onSubmit } = useFormAction(startDiscoveryAction);
  const [value, setValue] = useState(suggestion);
  const estimate = estimateText(value);

  useEffect(() => {
    if (state?.ok) onStarted();
  }, [state, onStarted]);

  return (
    <form onSubmit={onSubmit} className="scan-form">
      <label className="field">
        <span>Sottorete</span>
        <input
          className="input"
          name="subnet"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="192.168.1.0/24"
          maxLength={40}
          required
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <button type="submit" className="btn btn--primary" disabled={pending || busy}>
        {pending ? "Avvio…" : "Cerca"}
      </button>
      {state?.error && (
        <div className="notice notice--error" role="alert">
          {state.error}
        </div>
      )}
      <p className="form__hint">
        {estimate && (
          <>
            <b>{estimate}.</b>{" "}
          </>
        )}
        Il server prova ogni indirizzo con un ping e con alcune porte comuni. Va bene qualsiasi rete privata, dalla /8 alla
        /32, con il prefisso (/24) o con la maschera (255.255.255.0): una /16 richiede circa mezz&apos;ora, una /8 alcuni
        giorni, e la ricerca si può annullare in ogni momento. Se la rete ha un sistema che rileva le scansioni, può
        segnalarla.
      </p>
    </form>
  );
}

const remainingSeconds = (scan: DiscoveryScan) => scanSeconds(scan.total - scan.checked, scan.total);

function ScanProgress({ scan }: { scan: DiscoveryScan }) {
  const percent = scan.total > 0 ? Math.round((scan.checked / scan.total) * 100) : 0;
  return (
    <section className="panel scan-status" aria-live="polite">
      <div className="scan-status__head">
        <span>
          {scan.status === "queued"
            ? `In attesa del worker per ${scan.subnet}…`
            : `Ricerca in ${scan.subnet}: ${fmtCount(scan.checked)} indirizzi provati su ${fmtCount(scan.total)}` +
              (scan.total > scan.checked ? `, ne resta circa ${fmtDuration(remainingSeconds(scan))}` : "")}
        </span>
        <form action={cancelDiscoveryAction}>
          <input type="hidden" name="id" value={scan.id} />
          <button type="submit" className="btn btn--small">
            Annulla
          </button>
        </form>
      </div>
      <div
        className="scan-bar"
        role="progressbar"
        aria-label="Avanzamento della ricerca"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}

function ResultRow({
  item,
  selected,
  onToggle,
}: {
  item: DiscoveryItem;
  selected: boolean;
  onToggle: (address: string) => void;
}) {
  const ports = item.ports.map((port) => PORT_NAMES[port] ?? String(port));
  return (
    <tr className={item.known ? "scan-row--known" : undefined}>
      <td>
        {!item.known && (
          <input
            type="checkbox"
            name="address"
            value={item.address}
            checked={selected}
            aria-label={`Seleziona ${item.address}`}
            onChange={() => onToggle(item.address)}
          />
        )}
      </td>
      <td>
        <span className="cell-main">{item.address}</span>
        {(item.mac || item.vendor) && (
          <span className="cell-sub">{[item.vendor, item.mac].filter(Boolean).join(" · ")}</span>
        )}
      </td>
      {item.known ? (
        <td colSpan={2}>
          <span className="badge badge--paused">Già presente</span>{" "}
          <Link href={`/host/${item.known.id}`}>{item.known.name}</Link>
        </td>
      ) : (
        <>
          <td>
            <input
              className="input"
              name={`name:${item.address}`}
              defaultValue={item.name ?? ""}
              placeholder={item.address}
              maxLength={80}
              aria-label={`Nome di ${item.address}`}
            />
          </td>
          <td>
            <select
              className="select"
              name={`type:${item.address}`}
              defaultValue={item.type}
              aria-label={`Tipo di ${item.address}`}
            >
              {DEVICE_TYPES.map(({ key, label }) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </td>
        </>
      )}
      <td className="muted">{ports.length > 0 ? [...new Set(ports)].join(", ") : "—"}</td>
      <td className="muted">{reachText(item)}</td>
    </tr>
  );
}

function ScanResults({ scan, sectors, onAdded }: { scan: DiscoveryScan; sectors: string[]; onAdded: () => void }) {
  const { state, pending, onSubmit } = useFormAction(addDiscoveredHostsAction);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!state?.ok) return;
    setSelected(new Set());
    onAdded();
  }, [state, onAdded]);

  const fresh = scan.found.filter((item) => !item.known);
  const rows = [...fresh, ...scan.found.filter((item) => item.known)];
  const allSelected = fresh.length > 0 && fresh.every((item) => selected.has(item.address));

  function toggle(address: string) {
    const next = new Set(selected);
    if (!next.delete(address)) next.add(address);
    setSelected(next);
  }

  return (
    <>
      <p className="scan-summary">
        <b>{hostCount(scan.found.length)}</b> in {scan.subnet}, di cui <b>{fresh.length}</b> da aggiungere. Ricerca di{" "}
        {scan.createdBy}, {fmtDateTime(scan.created)}.
      </p>

      {state?.message && (
        <div className="notice notice--ok" role="status">
          {state.message}
        </div>
      )}

      {scan.found.length === 0 ? (
        <section className="panel">
          <div className="empty">Nessun dispositivo ha risposto in {scan.subnet}.</div>
        </section>
      ) : (
        <form onSubmit={onSubmit}>
          <input type="hidden" name="scan" value={scan.id} />
          {fresh.length > 0 && (
          <div className="bulk">
            <span className="bulk__count">{selected.size === 1 ? "1 selezionato" : `${selected.size} selezionati`}</span>
            <input
              className="input"
              name="sector"
              list="scan-sectors"
              placeholder="Settore (facoltativo)"
              maxLength={40}
              aria-label="Settore degli host da aggiungere"
            />
            <datalist id="scan-sectors">
              {sectors.map((sector) => (
                <option key={sector} value={sector} />
              ))}
            </datalist>
            <SubmitButton pending={pending} pendingLabel="Aggiunta…">
              Aggiungi selezionati
            </SubmitButton>
            {state?.error && (
              <div className="notice notice--error" role="alert">
                {state.error}
              </div>
            )}
          </div>
          )}
          <section className="panel">
            <div className="table-wrap">
              <table className="table scan-table">
                <thead>
                  <tr>
                    <th>
                      {fresh.length > 0 && (
                        <input
                          type="checkbox"
                          checked={allSelected}
                          aria-label="Seleziona tutti i nuovi"
                          onChange={() =>
                            setSelected(allSelected ? new Set() : new Set(fresh.map((item) => item.address)))
                          }
                        />
                      )}
                    </th>
                    <th>Indirizzo</th>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Porte aperte</th>
                    <th>Risposta</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <ResultRow
                      key={item.address}
                      item={item}
                      selected={selected.has(item.address)}
                      onToggle={toggle}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </form>
      )}
    </>
  );
}

export function DiscoveryAdmin({ suggestion, sectors }: { suggestion: string; sectors: string[] }) {
  const [scanning, setScanning] = useState(false);
  const { data, error, reload } = useLiveData<{ scan: DiscoveryScan | null }>(
    "/api/ricerca",
    scanning ? SCANNING_SECONDS : REFRESH_SECONDS,
  );
  const scan = data?.scan ?? null;
  const active = isActive(scan);

  useEffect(() => setScanning(active), [active]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Ricerca sulla rete</h1>
          <p>Trova i dispositivi di una sottorete e aggiungi quelli che mancano.</p>
        </div>
      </header>

      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}

      <section className="panel scan-panel">
        <SearchForm suggestion={suggestion} busy={active} onStarted={reload} />
      </section>

      {scan && active && <ScanProgress scan={scan} />}
      {scan?.status === "failed" && (
        <div className="notice notice--error" role="alert">
          Ricerca in {scan.subnet} non conclusa. {scan.error}
        </div>
      )}
      {scan?.status === "done" && <ScanResults key={scan.id} scan={scan} sectors={sectors} onAdded={reload} />}
    </>
  );
}
