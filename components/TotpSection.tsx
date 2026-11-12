"use client";

import { useState } from "react";
import type { FormState } from "@/lib/actions";
import { confirmTotpAction, disableTotpAction, startTotpAction } from "@/lib/actions-security";
import { FormNotices, SubmitButton, useFormAction } from "./forms";
import { QrCode } from "./QrCode";

interface Setup {
  secret: string;
  uri: string;
}

const setupOf = (state: FormState): Setup | null => {
  const data = state?.ok ? (state.data as Partial<Setup> | undefined) : undefined;
  return data?.secret && data.uri ? { secret: data.secret, uri: data.uri } : null;
};

const codesOf = (state: FormState): string[] | null => {
  const data = state?.ok ? (state.data as { codes?: string[] } | undefined) : undefined;
  return Array.isArray(data?.codes) ? data.codes : null;
};

const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

export function TotpSection({ enabled, recoveryLeft }: { enabled: boolean; recoveryLeft: number }) {
  const start = useFormAction(startTotpAction);
  const confirm = useFormAction(confirmTotpAction);
  const disable = useFormAction(disableTotpAction);
  // Le risposte restano nello stato delle azioni: "chiuse" ricorda quali non mostrare più
  const [closed, setClosed] = useState<FormState[]>([]);
  const [copied, setCopied] = useState(false);

  const setup = closed.includes(start.state) ? null : setupOf(start.state);
  const codes = closed.includes(confirm.state) ? null : codesOf(confirm.state);

  function close() {
    setClosed((list) => [...list, start.state, confirm.state]);
    setCopied(false);
  }

  async function copy(list: string[]) {
    try {
      await navigator.clipboard.writeText(list.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  let body;
  if (codes) {
    body = (
      <div className="form">
        <div className="notice notice--ok" role="status">
          Due fattori attivi. Da ora all&apos;accesso servirà anche il codice dell&apos;app.
        </div>
        <p>
          Questi sono i <b>codici di recupero</b>: ognuno vale una volta sola, se perdi il telefono. Salvali adesso in
          un posto sicuro (un gestore di password): <b>non li vedrai più</b>.
        </p>
        <ol className="recovery-codes">
          {codes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ol>
        <div className="form__actions">
          <button type="button" className="btn" onClick={() => copy(codes)}>
            {copied ? "Copiati" : "Copia i codici"}
          </button>
          <button type="button" className="btn btn--primary" onClick={close}>
            Li ho salvati
          </button>
        </div>
      </div>
    );
  } else if (setup) {
    body = (
      <form method="post" onSubmit={confirm.onSubmit} className="form">
        <FormNotices state={confirm.state} />
        <div className="totp-setup">
          <QrCode text={setup.uri} label="Codice QR da inquadrare con l'app di autenticazione" />
          <div className="totp-setup__steps">
            <p>
              1. Inquadra il codice con un&apos;app di autenticazione (Aegis, Google Authenticator, Microsoft
              Authenticator, 1Password…).
            </p>
            <p>
              Se non puoi inquadrarlo, inserisci a mano questa chiave:
              <code className="totp-secret">{grouped(setup.secret)}</code>
            </p>
            <label className="field">
              <span>2. Scrivi il codice di 6 cifre che mostra l&apos;app</span>
              <input
                className="input input--code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                required
                autoFocus
              />
            </label>
          </div>
        </div>
        <div className="form__actions">
          <button type="button" className="btn" onClick={close}>
            Annulla
          </button>
          <SubmitButton pending={confirm.pending} pendingLabel="Verifica…">
            Attiva
          </SubmitButton>
        </div>
      </form>
    );
  } else if (enabled) {
    body = (
      <form method="post" onSubmit={disable.onSubmit} className="form">
        <FormNotices state={disable.state} />
        <p>
          <span className="badge badge--online">Attivo</span> All&apos;accesso, dopo la password, Vigil chiede il codice
          dell&apos;app.
        </p>
        <p className={recoveryLeft <= 2 ? "notice notice--hint" : "muted"}>
          Codici di recupero rimasti: <b>{recoveryLeft}</b>
          {recoveryLeft <= 2 && ". Per averne di nuovi disattiva e riattiva i due fattori."}
        </p>
        <label className="field">
          <span>Password, per disattivare</span>
          <input className="input" name="password" type="password" autoComplete="current-password" required />
        </label>
        <div className="form__actions">
          <SubmitButton pending={disable.pending} pendingLabel="Disattivazione…">
            Disattiva i due fattori
          </SubmitButton>
        </div>
      </form>
    );
  } else {
    body = (
      <form method="post" onSubmit={start.onSubmit} className="form">
        <FormNotices state={start.state} />
        {disable.state?.ok && <FormNotices state={disable.state} />}
        <p>
          Oltre alla password, all&apos;accesso servirà un codice di 6 cifre generato dal telefono: chi ruba la password
          da sola non entra.
        </p>
        <div className="form__actions">
          <SubmitButton pending={start.pending} pendingLabel="Preparazione…">
            Attiva i due fattori
          </SubmitButton>
        </div>
      </form>
    );
  }

  return (
    <section className="panel narrow narrow--wide">
      <div className="panel__head">
        <h2 className="panel__title">Accesso con due fattori</h2>
      </div>
      {body}
    </section>
  );
}
