"use client";

import { useEffect, useRef, useState } from "react";
import { createAlertDeviceAction, deleteAlertDeviceAction } from "@/lib/actions";
import { fmtFullDate } from "@/lib/format";
import { LocalTime } from "./LocalTime";
import type { AlertDevice } from "@/lib/types";
import { ConfirmSubmit, SubmitButton, useFormAction } from "./forms";

function installCommand(token: string) {
  const site = window.location.origin;
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Invoke-RestMethod '${site}/avvisi-windows.ps1'))) -Installa -Token '${token}' -Sito '${site}'"`;
}

function InstallCommand({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const command = installCommand(token);

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
  }

  return (
    <div className="notice notice--hint">
      <p>Sul PC da collegare apri PowerShell e incolla questo comando. Non servono permessi di amministratore.</p>
      <pre className="command">{command}</pre>
      <p className="command__foot">
        <button type="button" className="btn btn--small" onClick={copy}>
          {copied ? "Copiato" : "Copia comando"}
        </button>
        <span className="muted">Si vede solo adesso: contiene la chiave di questo PC.</span>
      </p>
    </div>
  );
}

export function AlertDevices({ devices }: { devices: AlertDevice[] }) {
  const { state, pending, onSubmit } = useFormAction(createAlertDeviceAction);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);

  return (
    <section className="panel narrow narrow--wide">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">Avvisi su Windows</h2>
          <p className="panel__sub">
            I problemi arrivano nel centro notifiche del PC, anche con la dashboard chiusa. Ricevi gli avvisi degli host
            che puoi vedere.
          </p>
        </div>
      </div>

      {devices.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>PC</th>
                <th>Ultimo contatto</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id}>
                  <td>
                    <span className="cell-main">{device.name}</span>
                    <span className="cell-sub">
                      Collegato il <LocalTime seconds={device.createdAt} format={fmtFullDate} />
                    </span>
                  </td>
                  <td className="muted">{device.lastSeen ? <LocalTime seconds={device.lastSeen} format={fmtFullDate} /> : "Mai"}</td>
                  <td className="actions">
                    <form action={deleteAlertDeviceAction}>
                      <input type="hidden" name="id" value={device.id} />
                      <ConfirmSubmit label="Scollega" confirmLabel="Confermi?" />
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form ref={form} onSubmit={onSubmit} className="form form--inline">
        {state?.error && (
          <div className="notice notice--error" role="alert">
            {state.error}
          </div>
        )}
        <label className="field">
          <span>Nome del PC</span>
          <input className="input" name="name" maxLength={60} placeholder="PC ufficio IT" required />
        </label>
        <SubmitButton pending={pending} pendingLabel="Collegamento…">
          Collega un PC
        </SubmitButton>
      </form>

      {state?.token && <InstallCommand token={state.token} />}
    </section>
  );
}
