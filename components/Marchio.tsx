/** Marchio di tumas.net: prompt lime e cursore. Decorativo, il nome sta nel testo accanto. */
export function Marchio() {
  return (
    <svg aria-hidden="true" width="30" height="30" viewBox="0 0 32 32">
      <rect x="0.5" y="0.5" width="31" height="31" rx="6" fill="#1D222C" stroke="rgba(230,234,240,0.2)" />
      <path d="M8 10l6 6-6 6" fill="none" stroke="#A8E10C" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="16" y="20" width="9" height="3" rx="1" fill="#E6EAF0" />
    </svg>
  );
}

export function Credito() {
  // La sezione 13 dell'AGPL chiede di offrire il sorgente a chi usa Vigil attraverso la rete.
  const sorgente = process.env.SOURCE_URL || "https://github.com/TumasDevelopment/Vigil";
  return (
    <p className="credito">
      Progettata e distribuita da{" "}
      <a href="https://tumas.net" target="_blank" rel="noopener">
        tumas<span className="punto">.</span>net
      </a>
      <br />
      <a href={sorgente} target="_blank" rel="noopener">
        Codice sorgente
      </a>{" "}
      · AGPL-3.0
    </p>
  );
}
