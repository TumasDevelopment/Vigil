"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { FormState } from "@/lib/actions";

/**
 * Invia un'azione senza passare da <form action>, che dopo ogni invio svuota i
 * campi: con un errore di validazione si perderebbe quanto scritto.
 */
export function useFormAction(action: (state: FormState, form: FormData) => Promise<FormState>) {
  const [state, dispatch, pending] = useActionState(action, undefined);

  const submit = (form: FormData) => startTransition(() => dispatch(form));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit(new FormData(event.currentTarget));
  }

  return { state, pending, onSubmit, submit };
}

export function SubmitButton({
  children,
  pending,
  pendingLabel = "Salvataggio…",
}: {
  children: ReactNode;
  pending: boolean;
  pendingLabel?: string;
}) {
  return (
    <button type="submit" className="btn btn--primary" disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Pulsante in due tempi: il primo clic chiede conferma, il secondo invia il modulo. */
export function ConfirmSubmit({ label, confirmLabel }: { label: string; confirmLabel: string }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  function onClick(event: MouseEvent<HTMLButtonElement>) {
    if (!armed) {
      event.preventDefault();
      setArmed(true);
    }
  }

  return (
    <button type="submit" className={`btn btn--small btn--danger ${armed ? "btn--armed" : ""}`} onClick={onClick}>
      {armed ? confirmLabel : label}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  wide = false,
  className,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} onClose={onClose} className={className ?? (wide ? "dialog--wide" : undefined)}>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
