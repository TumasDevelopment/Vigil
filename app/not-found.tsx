import Link from "next/link";

export default function NotFound() {
  return (
    <main className="center-page">
      <h1>Pagina non trovata</h1>
      <Link className="btn" href="/">
        Torna alla panoramica
      </Link>
    </main>
  );
}
