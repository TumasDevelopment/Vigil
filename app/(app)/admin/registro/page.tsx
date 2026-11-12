import Link from "next/link";
import { IconDownload } from "@/components/icons";
import { LocalTime } from "@/components/LocalTime";
import { AUDIT_GROUPS, AUDIT_LABELS } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { listAudit, listAuditUsers } from "@/lib/queries-enterprise";

export const metadata = { title: "Registro · Vigil" };
export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

/** I dettagli salvati come JSON, in una riga leggibile. */
function detailText(detail: unknown): string {
  if (detail === null || detail === undefined) return "";
  if (typeof detail !== "object") return String(detail);
  return Object.entries(detail as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" · ");
}

export default async function AuditPage({ searchParams }: { searchParams: Search }) {
  await requireAdmin();
  const params = await searchParams;
  const user = one(params.utente);
  const action = one(params.azione);
  const q = one(params.q);
  const beforeText = one(params.prima);
  const before = /^\d{1,15}$/.test(beforeText) ? Number(beforeText) : undefined;

  const [{ rows, more }, users] = await Promise.all([
    listAudit({ user, action: action in AUDIT_GROUPS || action in AUDIT_LABELS ? action : undefined, q, before }),
    listAuditUsers(),
  ]);

  const filter = new URLSearchParams();
  if (user) filter.set("utente", user);
  if (action) filter.set("azione", action);
  if (q) filter.set("q", q);
  const nextPage = new URLSearchParams(filter);
  if (rows.length > 0) nextPage.set("prima", String(rows[rows.length - 1].id));
  const filtered = filter.size > 0;

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h1>Registro attività</h1>
          <p>Chi ha fatto cosa: accessi, modifiche, prese in carico, export. Le righe restano 365 giorni.</p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <a className="btn" href={`/api/registro.csv${filtered ? `?${filter}` : ""}`}>
            <IconDownload />
            Esporta CSV
          </a>
        </div>
      </header>

      <form method="get" className="toolbar">
        <select className="select" name="utente" defaultValue={user} aria-label="Utente">
          <option value="">Tutti gli utenti</option>
          {users.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select className="select" name="azione" defaultValue={action} aria-label="Azione">
          <option value="">Tutte le azioni</option>
          {Object.entries(AUDIT_GROUPS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <input className="input" type="search" name="q" defaultValue={q} placeholder="Cerca nell'oggetto" aria-label="Cerca" />
        <button type="submit" className="btn btn--primary">
          Filtra
        </button>
        {filtered && (
          <Link className="btn btn--ghost" href="/admin/registro">
            Azzera
          </Link>
        )}
      </form>

      <section className="panel">
        {rows.length === 0 ? (
          <div className="empty">{filtered || before ? "Nessuna riga con questi filtri." : "Il registro è ancora vuoto."}</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Utente</th>
                  <th>Azione</th>
                  <th>Oggetto</th>
                  <th>Indirizzo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const detail = detailText(row.detail);
                  return (
                    <tr key={row.id}>
                      <td className="muted nowrap">
                        <LocalTime seconds={row.ts} format="dateTime" />
                      </td>
                      <td className="nowrap">{row.username ?? <span className="muted">—</span>}</td>
                      <td>
                        <span className="cell-main">{AUDIT_LABELS[row.action] ?? row.action}</span>
                        <span className="cell-sub mono">{row.action}</span>
                      </td>
                      <td>
                        {row.target ?? <span className="muted">—</span>}
                        {detail && <span className="cell-sub audit-detail">{detail}</span>}
                      </td>
                      <td className="muted mono nowrap">{row.ip ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(more || before) && (
        <div className="toolbar">
          {before && (
            <Link className="btn btn--ghost" href={`/admin/registro${filtered ? `?${filter}` : ""}`}>
              Torna alle più recenti
            </Link>
          )}
          {more && (
            <Link className="btn" href={`/admin/registro?${nextPage}`}>
              Più vecchie
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
