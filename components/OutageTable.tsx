"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { saveOutageNoteAction } from "@/lib/actions";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import type { OutageRow } from "@/lib/types";
import { Modal, SubmitButton, useFormAction } from "./forms";
import { IconOffline, IconOnline } from "./icons";

interface Props {
  outages: OutageRow[];
  now: number;
  range: string;
  showHost?: boolean;
  compact?: boolean;
  /** Chi sta guardando, se può prendere in carico: gli altri leggono soltanto */
  ackAs?: string | null;
  onSaved?: () => void;
}

function NoteForm({
  outage,
  ackAs,
  onSaved,
  onDone,
}: {
  outage: OutageRow;
  ackAs: string;
  onSaved?: () => void;
  onDone: () => void;
}) {
  const { state, pending, onSubmit } = useFormAction(saveOutageNoteAction);
  const heldByOther = outage.ackBy !== null && outage.ackBy !== ackAs;

  useEffect(() => {
    if (!state?.ok) return;
    onSaved?.();
    onDone();
  }, [state, onSaved, onDone]);

  return (
    <form onSubmit={onSubmit} className="form">
      <input type="hidden" name="id" value={outage.id} />
      <input type="hidden" name="kind" value={outage.service === null ? "host" : "service"} />
      {state?.error && (
        <div className="notice notice--error" role="alert">
          {state.error}
        </div>
      )}
      <p className="form__hint">
        <b>{outage.hostName}</b>
        {outage.service ? ` · ${outage.service}` : ""} · dal {fmtDateTime(outage.started)}
      </p>
      {heldByOther && (
        <label className="check">
          <input type="checkbox" name="takeover" />
          <span>Prendi in carico al posto di {outage.ackBy}</span>
        </label>
      )}
      <label className="field">
        <span>Nota (facoltativa)</span>
        <textarea
          className="textarea"
          name="note"
          defaultValue={outage.note}
          maxLength={500}
          placeholder="Causa del guasto, cosa si sta facendo…"
          autoFocus
        />
        <small>Le interruzioni con una nota restano nello storico anche dopo la pulizia dei dati.</small>
      </label>
      <div className="form__actions">
        <button type="button" className="btn" onClick={onDone}>
          Annulla
        </button>
        <SubmitButton pending={pending}>{outage.ackBy === null ? "Prendi in carico" : "Salva"}</SubmitButton>
      </div>
    </form>
  );
}

export function OutageTable({ outages, now, range, showHost = true, compact = false, ackAs = null, onSaved }: Props) {
  const [editing, setEditing] = useState<OutageRow | null>(null);
  const closeEditor = () => setEditing(null);

  if (outages.length === 0) return <div className="empty">Nessuna interruzione nel periodo.</div>;
  const showService = outages.some((outage) => outage.service !== null);
  // Nella tabella stretta le note stanno sotto il nome, dove c'è più spazio
  const notesUnderHost = compact && showHost;
  const notes = (outage: OutageRow) => (
    <>
      {outage.causeName && <span className="cell-sub">Causa: {outage.causeName}</span>}
      {outage.inMaintenance && <span className="cell-sub">Durante una manutenzione</span>}
      {compact && outage.ackBy && <span className="cell-sub">In carico a {outage.ackBy}</span>}
    </>
  );

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Stato</th>
              {showHost && <th>Host</th>}
              {showService && <th>Servizio</th>}
              <th>Inizio</th>
              {!compact && <th>Fine</th>}
              <th className="num">Durata</th>
              {!compact && <th>Presa in carico</th>}
            </tr>
          </thead>
          <tbody>
            {outages.map((outage) => (
              <tr key={`${outage.service === null ? "h" : "s"}${outage.id}`}>
                <td>
                  {outage.ended === null ? (
                    <span className="badge badge--offline">
                      <IconOffline />
                      In corso
                    </span>
                  ) : (
                    <span className="badge badge--online">
                      <IconOnline />
                      Risolta
                    </span>
                  )}
                  {!notesUnderHost && notes(outage)}
                </td>
                {showHost && (
                  <td>
                    <Link className="cell-main" href={`/host/${outage.hostId}?range=${range}`}>
                      {outage.hostName}
                    </Link>
                    {!compact && (
                      <span className="cell-sub">
                        {outage.address}
                        {outage.sector ? ` · ${outage.sector}` : ""}
                      </span>
                    )}
                    {notesUnderHost && notes(outage)}
                  </td>
                )}
                {showService && <td className="muted">{outage.service ?? "Tutto l'host"}</td>}
                <td className="muted nowrap">{fmtDateTime(outage.started)}</td>
                {!compact && <td className="muted nowrap">{outage.ended ? fmtDateTime(outage.ended) : "—"}</td>}
                <td className="num">{fmtDuration((outage.ended ?? now) - outage.started)}</td>
                {!compact && (
                  <td className="outage-ack">
                    {outage.ackBy && (
                      <>
                        <span className="cell-main">{outage.ackBy}</span>
                        {outage.ackAt !== null && <span className="cell-sub">{fmtDateTime(outage.ackAt)}</span>}
                      </>
                    )}
                    {outage.note && <p className="outage-ack__note">{outage.note}</p>}
                    {ackAs ? (
                      <button type="button" className="btn btn--small" onClick={() => setEditing(outage)}>
                        {outage.ackBy ? "Modifica" : "Prendi in carico"}
                      </button>
                    ) : (
                      !outage.ackBy && !outage.note && <span className="muted">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && ackAs && (
        <Modal title={editing.ackBy ? "Nota sull'interruzione" : "Prendi in carico"} onClose={closeEditor}>
          <NoteForm outage={editing} ackAs={ackAs} onSaved={onSaved} onDone={closeEditor} />
        </Modal>
      )}
    </>
  );
}
