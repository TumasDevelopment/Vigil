"use client";

import { loginAction } from "@/lib/actions";
import { SubmitButton, useFormAction } from "./forms";

export function LoginForm() {
  const { state, pending, onSubmit } = useFormAction(loginAction);

  return (
    <form method="post" onSubmit={onSubmit} className="form">
      {state?.error && (
        <div className="notice notice--error" role="alert">
          {state.error}
        </div>
      )}
      <label className="field">
        <span>Nome utente</span>
        <input className="input" name="username" autoComplete="username" autoFocus required />
      </label>
      <label className="field">
        <span>Password</span>
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </label>
      <SubmitButton pending={pending} pendingLabel="Accesso…">
        Accedi
      </SubmitButton>
    </form>
  );
}
