"use client";

import { useState, useTransition } from "react";
import { cancelTotpAction, loginAction, verifyTotpAction } from "@/lib/actions";
import { SubmitButton, useFormAction } from "./forms";

type Step = "password" | "totp";

/** Accesso in due passi: password, poi (se attivi) il codice dei due fattori. */
export function LoginForm({ codeStep = false }: { codeStep?: boolean }) {
  const login = useFormAction(loginAction);
  const verify = useFormAction(verifyTotpAction);
  const [step, setStep] = useState<Step>(codeStep ? "totp" : "password");
  const [error, setError] = useState<string | null>(null);
  const [leaving, startLeaving] = useTransition();

  // Ogni nuova risposta decide il passo e il messaggio da mostrare
  const [seenLogin, setSeenLogin] = useState(login.state);
  if (login.state !== seenLogin) {
    setSeenLogin(login.state);
    setError(login.state?.error ?? null);
    if (login.state?.next === "totp") setStep("totp");
  }
  const [seenVerify, setSeenVerify] = useState(verify.state);
  if (verify.state !== seenVerify) {
    setSeenVerify(verify.state);
    setError(verify.state?.error ?? null);
    if (verify.state?.next === "password") setStep("password");
  }

  function back() {
    startLeaving(async () => {
      await cancelTotpAction();
      setError(null);
      setStep("password");
    });
  }

  const notice = error && (
    <div className="notice notice--error" role="alert">
      {error}
    </div>
  );

  if (step === "totp") {
    return (
      <form key="totp" method="post" onSubmit={verify.onSubmit} className="form">
        {notice}
        <p className="muted">Apri l&apos;app di autenticazione e scrivi il codice di Vigil.</p>
        <label className="field">
          <span>Codice a 6 cifre</span>
          <input
            className="input input--code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={20}
            autoFocus
            required
          />
          <small>Hai perso il telefono? Usa uno dei codici di recupero.</small>
        </label>
        <SubmitButton pending={verify.pending} pendingLabel="Verifica…">
          Accedi
        </SubmitButton>
        <button type="button" className="btn btn--ghost" onClick={back} disabled={leaving}>
          Torna alla password
        </button>
      </form>
    );
  }

  return (
    <form key="password" method="post" onSubmit={login.onSubmit} className="form">
      {notice}
      <label className="field">
        <span>Nome utente</span>
        <input className="input" name="username" autoComplete="username" autoFocus required />
      </label>
      <label className="field">
        <span>Password</span>
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </label>
      <SubmitButton pending={login.pending} pendingLabel="Accesso…">
        Accedi
      </SubmitButton>
    </form>
  );
}
