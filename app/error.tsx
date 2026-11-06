"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="center-page">
      <h1>Si è verificato un errore</h1>
      <p className="muted">Il server non ha risposto come previsto.</p>
      <button type="button" className="btn" onClick={reset}>
        Riprova
      </button>
    </main>
  );
}
