"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { deleteDomainAction, recheckDomainAction, saveDomainAction } from "@/lib/actions-enterprise";
import { fmtDate, fmtDateTime, fmtDay } from "@/lib/format";
import type { CertRow, DomainRow, WarrantyRow } from "@/lib/queries-enterprise";
import { ConfirmSubmit, FormNotices, Modal, SubmitButton, useFormAction } from "./forms";
import { IconPlus } from "./icons";
import { LocalTime } from "./LocalTime";

const DAY = 86_400;

/** Giorni interi che mancano; negativi se la data è passata. */
const daysLeft = (expiresAt: number, now: number) => Math.floor((expiresAt - now) / DAY);

function Remaining({ expiresAt, now, warnDays }: { expiresAt: number | null; now: number; warnDays: number }) {
  if (expiresAt === null) return <span className="badge badge--unknown">Sconosciuta</span>;
  const days = daysLeft(expiresAt, now);
  if (days < 0) return <span className="badge badge--offline">Scaduto</span>;
  const label = days === 0 ? "Oggi" : days === 1 ? "1 giorno" : `${days} giorni`;
  const tone = days <= Math.min(7, warnDays) ? "offline" : days <= warnDays ? "unstable" : "online";
  return <span className={`badge badge--${tone}`}>{label}</span>;
}

/** Una data YYYY-MM-DD vale fino alla fine del giorno. */
const dayEnd = (day: string) => Date.parse(`${day}T23:59:59Z`) / 1000;

function DomainForm({ item, onDone }: { item: DomainRow | null; onDone: () => void }) {
  const { state, pending, onSubmit } = useFormAction(saveDomainAction);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form onSubmit={onSubmit} className="form">
      {item && <input type="hidden" name="id" value={item.id} />}
      <FormNotices state={state} />
      <label className="field">
        <span>Dominio</span>
        <input
          className="input"
          name="name"
          defaultValue={item?.name ?? ""}
          placeholder="esempio.it"
          autoComplete="off"
          spellCheck={false}
          required
          autoFocus
        />
        <small>Solo il nome registrato, senza www né https://.</small>
      </label>
      <label className="field">
        <span>Avvisa con giorni di anticipo</span>
        <input className="input" type="number" name="warnDays" min={1} max={365} defaultValue={item?.warnDays ?? 30} required />
      </label>
      <div className="form__actions">
        <SubmitButton pending={pending}>{item ? "Salva" : "Aggiungi"}</SubmitButton>
      </div>
    </form>
  );
}

export function DeadlinesAdmin({
  domains,
  certs,
  warranties,
  warrantyDays,
  now,
}: {
  domains: DomainRow[];
  certs: CertRow[];
  warranties: WarrantyRow[];
  warrantyDays: number;
  now: number;
}) {
  const [editing, setEditing] = useState<DomainRow | "new" | null>(null);
  const closeEditor = () => setEditing(null);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h1>Scadenze</h1>
          <p>Domini, certificati TLS e garanzie: un avviso prima che scadano.</p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button type="button" className="btn btn--primary" onClick={() => setEditing("new")}>
            <IconPlus />
            Nuovo dominio
          </button>
        </div>
      </header>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Domini</h2>
        </div>
        {domains.length === 0 ? (
          <div className="empty">Nessun dominio. Aggiungine uno: la scadenza si legge da RDAP o WHOIS.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Dominio</th>
                  <th>Scadenza</th>
                  <th>Mancano</th>
                  <th>Ultimo controllo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {domains.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="cell-main">{item.name}</span>
                      <span className="cell-sub">
                        {item.registrar ?? "Registrar sconosciuto"} · avviso a {item.warnDays} giorni
                      </span>
                    </td>
                    <td className="nowrap">
                      <LocalTime seconds={item.expiresAt} format={fmtDate} />
                    </td>
                    <td>
                      <Remaining expiresAt={item.expiresAt} now={now} warnDays={item.warnDays} />
                    </td>
                    <td className="muted">
                      {item.checkedAt === null ? (
                        "In coda"
                      ) : (
                        <>
                          <LocalTime seconds={item.checkedAt} format={fmtDateTime} />
                          {item.source && <span className="cell-sub">{item.source.toUpperCase()}</span>}
                        </>
                      )}
                      {item.error && <span className="cell-sub text-danger">{item.error}</span>}
                    </td>
                    <td className="actions">
                      <button type="button" className="btn btn--small" onClick={() => setEditing(item)}>
                        Modifica
                      </button>
                      <form action={recheckDomainAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <button type="submit" className="btn btn--small btn--ghost">
                          Ricontrolla
                        </button>
                      </form>
                      <form action={deleteDomainAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <ConfirmSubmit label="Elimina" confirmLabel="Elimina il dominio" />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Certificati TLS</h2>
        </div>
        {certs.length === 0 ? (
          <div className="empty">
            Nessun controllo del certificato. Si aggiunge dalla scheda di un host, tra i servizi (tipo «Certificato»).
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Servizio</th>
                  <th>Scadenza</th>
                  <th>Mancano</th>
                  <th>Ultimo controllo</th>
                </tr>
              </thead>
              <tbody>
                {certs.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="cell-main">{item.name}</span>
                      <span className="cell-sub">
                        <Link href={`/host/${item.hostId}`}>{item.hostName}</Link> · avviso a {item.warnDays} giorni
                      </span>
                    </td>
                    <td className="nowrap">
                      <LocalTime seconds={item.expiresAt} format={fmtDate} />
                    </td>
                    <td>
                      {item.status === "failed" && item.expiresAt === null ? (
                        <span className="badge badge--offline">Errore</span>
                      ) : (
                        <Remaining expiresAt={item.expiresAt} now={now} warnDays={item.warnDays} />
                      )}
                    </td>
                    <td className="muted">
                      <LocalTime seconds={item.lastCheck} format={fmtDateTime} />
                      {item.detail && <span className="cell-sub">{item.detail}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Garanzie</h2>
          <span className="muted">Avviso {warrantyDays} giorni prima</span>
        </div>
        {warranties.length === 0 ? (
          <div className="empty">Nessuna data di fine garanzia. Si scrive nella scheda dell&apos;host, sezione Inventario.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Dispositivo</th>
                  <th>Fine garanzia</th>
                  <th>Mancano</th>
                </tr>
              </thead>
              <tbody>
                {warranties.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="cell-main">
                        <Link href={`/host/${item.id}`}>{item.name}</Link>
                      </span>
                      <span className="cell-sub">
                        {[item.manufacturer, item.model].filter(Boolean).join(" ") || "—"}
                        {item.sector && ` · ${item.sector}`}
                      </span>
                    </td>
                    <td className="nowrap">{fmtDay(item.warrantyUntil)}</td>
                    <td>
                      <Remaining expiresAt={dayEnd(item.warrantyUntil)} now={now} warnDays={warrantyDays} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <Modal title={editing === "new" ? "Nuovo dominio" : "Modifica dominio"} onClose={closeEditor}>
          <DomainForm item={editing === "new" ? null : editing} onDone={closeEditor} />
        </Modal>
      )}
    </div>
  );
}
