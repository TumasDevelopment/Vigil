"use client";

import { useState } from "react";
import { createApiKeyAction, deleteApiKeyAction } from "@/lib/actions-security";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { ApiKeyRow } from "@/lib/queries-enterprise";
import { ConfirmSubmit, FormNotices, Modal, SubmitButton, useFormAction } from "./forms";
import { IconPlus } from "./icons";
import { LocalTime } from "./LocalTime";

const ENDPOINTS: [string, string, string][] = [
  ["GET", "/api/v1/status", "Riepilogo: quanti host per stato e quali hanno problemi."],
  ["GET", "/api/v1/hosts", "Tutti gli host con stato, latenza e perdita."],
  ["GET", "/api/v1/hosts/{id}", "Un host."],
  ["POST", "/api/v1/hosts", "Nuovo host: { name, address, sector?, type?, ping?, critical?, publicLabel? }."],
  ["DELETE", "/api/v1/hosts/{id}", "Elimina un host."],
  ["GET", "/api/v1/outages?state=open", "Interruzioni (open, closed, noted) e ?range= come in Eventi."],
  ["POST", "/api/v1/outages/{id}/ack", "Presa in carico: { kind?: host | service, note? }."],
  ["GET", "/api/v1/alerts?after={id}", "Avvisi successivi a un id; senza after solo l'ultimo id."],
  ["GET", "/api/v1/maintenance", "Manutenzioni programmate e in corso."],
  ["POST", "/api/v1/maintenance", "Nuova manutenzione: { hostId } o { sector }, più { ends, starts?, reason? }."],
];

function NewKeyForm() {
  const { state, pending, onSubmit } = useFormAction(createApiKeyAction);
  const [copied, setCopied] = useState(false);

  if (state?.token) {
    const token = state.token;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(token);
        setCopied(true);
      } catch {
        setCopied(false);
      }
    };
    return (
      <div className="form">
        <div className="notice notice--ok" role="status">
          Chiave creata. Copiala adesso: non verrà più mostrata.
        </div>
        <div className="token-box">
          <code>{token}</code>
          <button type="button" className="btn btn--small" onClick={copy}>
            {copied ? "Copiata" : "Copia"}
          </button>
        </div>
        <p className="form__hint">
          Si usa nell&apos;intestazione <b>Authorization: Bearer</b> seguita dalla chiave.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <FormNotices state={state} />
      <label className="field">
        <span>Nome</span>
        <input className="input" name="name" maxLength={80} placeholder="Cruscotto in reception" required autoFocus />
        <small>Compare nel registro attività come api:nome.</small>
      </label>
      <div className="form__row">
        <label className="field">
          <span>Permesso</span>
          <select className="select" name="scope" defaultValue="read">
            <option value="read">Sola lettura</option>
            <option value="write">Lettura e scrittura</option>
          </select>
        </label>
        <label className="field">
          <span>Durata</span>
          <select className="select" name="days" defaultValue="365">
            <option value="30">30 giorni</option>
            <option value="90">90 giorni</option>
            <option value="365">1 anno</option>
            <option value="0">Senza scadenza</option>
          </select>
        </label>
      </div>
      <p className="form__hint">
        La chiave vede tutti gli host, come un amministratore. Con la scrittura può creare ed eliminare host, prendere in
        carico i guasti e programmare manutenzioni.
      </p>
      <div className="form__actions">
        <SubmitButton pending={pending} pendingLabel="Creazione…">
          Crea la chiave
        </SubmitButton>
      </div>
    </form>
  );
}

export function ApiKeysAdmin({ keys, now }: { keys: ApiKeyRow[]; now: number }) {
  // Ogni apertura parte da un form nuovo: la chiave appena creata non deve ricomparire
  const [opened, setOpened] = useState(0);
  const close = () => setOpened(0);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h1>Chiavi API</h1>
          <p>Per collegare Vigil ad altri programmi: cruscotti, script, sistemi di ticket.</p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button type="button" className="btn btn--primary" onClick={() => setOpened(Date.now())}>
            <IconPlus />
            Nuova chiave
          </button>
        </div>
      </header>

      <section className="panel">
        {keys.length === 0 ? (
          <div className="empty">Nessuna chiave. Creane una per usare le API.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Permesso</th>
                  <th>Scadenza</th>
                  <th>Ultimo uso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => {
                  const expired = key.expiresAt !== null && key.expiresAt <= now;
                  return (
                    <tr key={key.id}>
                      <td>
                        <span className="cell-main">{key.name}</span>
                        <span className="cell-sub mono">{key.prefix}…</span>
                      </td>
                      <td>
                        <span className={`badge ${key.scope === "write" ? "badge--unstable" : "badge--paused"}`}>
                          {key.scope === "write" ? "Scrittura" : "Lettura"}
                        </span>
                      </td>
                      <td className="nowrap">
                        {key.expiresAt === null ? (
                          <span className="muted">Mai</span>
                        ) : expired ? (
                          <span className="badge badge--offline">Scaduta</span>
                        ) : (
                          <LocalTime seconds={key.expiresAt} format={fmtDate} />
                        )}
                        <span className="cell-sub">
                          Creata <LocalTime seconds={key.createdAt} format={fmtDate} />
                          {key.createdBy && ` da ${key.createdBy}`}
                        </span>
                      </td>
                      <td className="muted nowrap">
                        {key.lastUsed === null ? "Mai usata" : <LocalTime seconds={key.lastUsed} format={fmtDateTime} />}
                      </td>
                      <td className="actions">
                        <form action={deleteApiKeyAction}>
                          <input type="hidden" name="id" value={key.id} />
                          <ConfirmSubmit label="Revoca" confirmLabel="Revoca la chiave" />
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Come si usa</h2>
        </div>
        <div className="form">
          <p className="form__hint">
            Ogni richiesta porta la chiave nell&apos;intestazione, per esempio:{" "}
            <code>curl -H &quot;Authorization: Bearer vgk_…&quot; https://vigil.example/api/v1/status</code>. Le risposte
            sono JSON, le date in ISO 8601 (UTC). Errori: 401 chiave mancante o scaduta, 403 permesso insufficiente.
          </p>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {ENDPOINTS.map(([method, path, text]) => (
                  <tr key={`${method} ${path}`}>
                    <td className="nowrap">
                      <span className={`method method--${method.toLowerCase()}`}>{method}</span>
                    </td>
                    <td className="mono nowrap">{path}</td>
                    <td className="muted">{text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {opened > 0 && (
        <Modal key={opened} title="Nuova chiave API" onClose={close}>
          <NewKeyForm />
        </Modal>
      )}
    </div>
  );
}
