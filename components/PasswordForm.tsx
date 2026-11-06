"use client";

import { useEffect, useRef } from "react";
import { changeOwnPasswordAction } from "@/lib/actions";
import { SubmitButton, useFormAction } from "./forms";

export function PasswordForm() {
  const { state, pending, onSubmit } = useFormAction(changeOwnPasswordAction);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} method="post" onSubmit={onSubmit} className="form">
      {state?.error && (
        <div className="notice notice--error" role="alert">
          {state.error}
        </div>
      )}
      {state?.message && (
        <div className="notice notice--ok" role="status">
          {state.message}
        </div>
      )}
      <label className="field">
        <span>Password attuale</span>
        <input className="input" name="current" type="password" autoComplete="current-password" required />
      </label>
      <label className="field">
        <span>Nuova password</span>
        <input
          className="input"
          name="next"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
        <small>Almeno 8 caratteri.</small>
      </label>
      <label className="field">
        <span>Ripeti la nuova password</span>
        <input className="input" name="confirm" type="password" autoComplete="new-password" required />
      </label>
      <div className="form__actions">
        <SubmitButton pending={pending}>Cambia password</SubmitButton>
      </div>
    </form>
  );
}
