"use client";

import { useEffect, useState } from "react";
import { deleteMaintenanceAction, endMaintenanceAction, saveMaintenanceAction } from "@/lib/actions";
import { fmtDateTime } from "@/lib/format";
import { NO_SECTOR_LABEL } from "@/lib/scope";
import type { MaintenanceWindow } from "@/lib/types";
import { ConfirmSubmit, Modal, SubmitButton, useFormAction } from "./forms";
import { IconClock, IconOnline, IconPlus, IconWrench } from "./icons";
import { LocalTime } from "./LocalTime";

export interface MaintenanceHost {
  id: number;
  name: string;
  sector: string;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Il formato di <input type="datetime-local">, nel fuso del browser. */
function toLocalInput(date: Date) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(local: string) {
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

const ONE_HOUR_MS = 3_600_000;

function MaintenanceForm({
  item,
  hosts,
  onDone,
}: {
  item: MaintenanceWindow | null;
  hosts: MaintenanceHost[];
  onDone: () => void;
}) {
  const { state, pending, onSubmit } = useFormAction(saveMaintenanceAction);
  const [starts, setStarts] = useState(() => toLocalInput(item ? new Date(item.starts * 1000) : new Date()));
  const [ends, setEnds] = useState(() =>
    toLocalInput(item ? new Date(item.ends * 1000) : new Date(Date.now() + ONE_HOUR_MS)),
  );

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  const running = item?.state === "running";
  const sectors = [...new Set([...hosts.map((host) => host.sector), ...(item?.sector != null ? [item.sector] : [])])].sort(
    (a, b) => (!a !== !b ? (a ? -1 : 1) : a.localeCompare(b, "it")),
  );
  const target = item ? (item.hostId !== null ? `h:${item.hostId}` : `s:${item.sector}`) : "";

  return (
    <form onSubmit={onSubmit} className="form">
      {item && <input type="hidden" name="id" value={item.id} />}
      <input type="hidden" name="starts" value={toIso(starts)} />
      <input type="hidden" name="ends" value={toIso(ends)} />
      {state?.error && (
        <div className="notice notice--error" role="alert">
          {state.error}
        </div>
      )}
      <label className="field">
        <span>Riguarda</span>
        <select className="select" name="target" defaultValue={target} disabled={running} required>
          <option value="" disabled>
            Scegli un settore o un host
          </option>
          <optgroup label="Settori">
            {sectors.map((sector) => (
              <option key={sector} value={`s:${sector}`}>
                {sector || NO_SECTOR_LABEL}
              </option>
            ))}
          </optgroup>
          <optgroup label="Host">
            {hosts.map((host) => (
              <option key={host.id} value={`h:${host.id}`}>
                {host.name}
              </option>
            ))}
          </optgroup>
        </select>
        <small>Sono compresi anche i dispositivi collegati a valle.</small>
      </label>
      <div className="form__row">
        <label className="field">
          <span>Inizio</span>
          <input
            className="input"
            type="datetime-local"
            aria-label="Inizio"
            value={starts}
            disabled={running}
            required
            onChange={(event) => setStarts(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Fine</span>
          <input
            className="input"
            type="datetime-local"
            aria-label="Fine"
            value={ends}
            required
            onChange={(event) => setEnds(event.target.value)}
          />
        </label>
      </div>
      <label className="field">
        <span>Motivo (facoltativo)</span>
        <input
          className="input"
          name="reason"
          defaultValue={item?.reason}
          maxLength={200}
          placeholder="Aggiornamento firmware, lavori all'impianto…"
        />
      </label>
      <p className="form__hint">
        Durante la finestra non partono avvisi e i ping non contano nella disponibilità. Se alla fine il dispositivo è
        ancora giù, arriva un avviso.
      </p>
      <div className="form__actions">
        <button type="button" className="btn" onClick={onDone}>
          Annulla
        </button>
        <SubmitButton pending={pending}>Salva</SubmitButton>
      </div>
    </form>
  );
}

function StateBadge({ state }: { state: MaintenanceWindow["state"] }) {
  if (state === "running") {
    return (
      <span className="badge badge--maintenance">
        <IconWrench />
        In corso
      </span>
    );
  }
  if (state === "scheduled") {
    return (
      <span className="badge badge--unknown">
        <IconClock />
        Programmata
      </span>
    );
  }
  return (
    <span className="badge badge--paused">
      <IconOnline />
      Conclusa
    </span>
  );
}

export function MaintenanceAdmin({ windows, hosts }: { windows: MaintenanceWindow[]; hosts: MaintenanceHost[] }) {
  const [editing, setEditing] = useState<MaintenanceWindow | "new" | null>(null);
  const closeEditor = () => setEditing(null);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Manutenzioni</h1>
          <p>Le finestre in cui un host o un settore non genera avvisi e non pesa sulla disponibilità.</p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button type="button" className="btn btn--primary" onClick={() => setEditing("new")}>
            <IconPlus />
            Nuova manutenzione
          </button>
        </div>
      </header>

      <section className="panel">
        {windows.length === 0 ? (
          <div className="empty">Nessuna manutenzione. Programmane una prima di fermare un dispositivo.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Stato</th>
                  <th>Riguarda</th>
                  <th>Inizio</th>
                  <th>Fine</th>
                  <th>Motivo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {windows.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <StateBadge state={item.state} />
                    </td>
                    <td>
                      <span className="cell-main">{item.hostName ?? `Settore ${item.sector || NO_SECTOR_LABEL}`}</span>
                      <span className="cell-sub">{item.covered === 1 ? "1 host" : `${item.covered} host`}</span>
                    </td>
                    <td className="muted nowrap">
                      <LocalTime seconds={item.starts} format={fmtDateTime} />
                    </td>
                    <td className="muted nowrap">
                      <LocalTime seconds={item.ends} format={fmtDateTime} />
                    </td>
                    <td>
                      {item.reason || <span className="muted">—</span>}
                      <span className="cell-sub">Creata da {item.createdBy}</span>
                    </td>
                    <td className="actions">
                      {item.state !== "done" && (
                        <button type="button" className="btn btn--small" onClick={() => setEditing(item)}>
                          Modifica
                        </button>
                      )}
                      {/* La chiave azzera la conferma: quella data a "Termina" non deve valere per "Elimina" */}
                      {item.state === "running" ? (
                        <form key="end" action={endMaintenanceAction}>
                          <input type="hidden" name="id" value={item.id} />
                          <ConfirmSubmit label="Termina adesso" confirmLabel="Conferma la fine" />
                        </form>
                      ) : (
                        <form key="delete" action={deleteMaintenanceAction}>
                          <input type="hidden" name="id" value={item.id} />
                          {item.state === "scheduled" ? (
                            <ConfirmSubmit label="Elimina" confirmLabel="Elimina la manutenzione" />
                          ) : (
                            <ConfirmSubmit label="Elimina" confirmLabel="Torna a pesare sulla disponibilità" />
                          )}
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing !== null && (
        <Modal title={editing === "new" ? "Nuova manutenzione" : "Modifica manutenzione"} onClose={closeEditor}>
          <MaintenanceForm item={editing === "new" ? null : editing} hosts={hosts} onDone={closeEditor} />
        </Modal>
      )}
    </>
  );
}
