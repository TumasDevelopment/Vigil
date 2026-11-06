import { requireAdmin } from "@/lib/auth";
import { fmtBytes, fmtCount, fmtFullDate } from "@/lib/format";
import { getSystemInfo } from "@/lib/queries";

export const metadata = { title: "Sistema · Vigil" };

export default async function SystemPage() {
  await requireAdmin();
  const info = await getSystemInfo();

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Sistema</h1>
          <p>Salute del servizio di ping e pulizia dei dati</p>
        </div>
      </header>

      <div className="stack">
        <div className="grid-2 grid-2--even">
          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Servizio di ping</h2>
            </div>
            <dl className="facts">
              <dt>Stato</dt>
              <dd>{info.pinger.healthy ? "Attivo" : "Non risponde"}</dd>
              <dt>Ultimo ciclo</dt>
              <dd>{fmtFullDate(info.pinger.lastBeat)}</dd>
              <dt>Durata ciclo</dt>
              <dd>{info.cycleDurationMs === null ? "—" : `${fmtCount(info.cycleDurationMs)} ms`}</dd>
              <dt>Host pingati</dt>
              <dd>{info.hostsPinged ?? "—"}</dd>
            </dl>
          </section>

          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Database</h2>
            </div>
            <dl className="facts">
              <dt>Dimensione totale</dt>
              <dd>{fmtBytes(info.db_bytes)}</dd>
              <dt>Tabella ping</dt>
              <dd>{fmtBytes(info.table_bytes)}</dd>
              <dt>Righe (stima)</dt>
              <dd>{fmtCount(Math.round(info.rows))}</dd>
              <dt>Dato più vecchio</dt>
              <dd>{fmtFullDate(info.oldest)}</dd>
            </dl>
          </section>
        </div>

        <section className="panel">
          <div className="panel__head">
            <div>
              <h2 className="panel__title">Pulizia automatica</h2>
              <p className="panel__sub">
                Ogni {info.cycleDays} giorni vengono cancellati i dati più vecchi di {info.keepDays} giorni.
              </p>
            </div>
          </div>
          <dl className="facts" style={{ marginBottom: 14 }}>
            <dt>Conteggio iniziato o ultima pulizia</dt>
            <dd>{fmtFullDate(info.lastCleanup)}</dd>
            <dt>Prossima pulizia</dt>
            <dd>{fmtFullDate(info.nextCleanup)}</dd>
          </dl>

          {info.cleanups.length === 0 ? (
            <div className="empty">Nessuna pulizia eseguita finora.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Eseguita il</th>
                    <th>Cancellati i dati prima del</th>
                    <th className="num">Ping</th>
                    <th className="num">Interruzioni</th>
                  </tr>
                </thead>
                <tbody>
                  {info.cleanups.map((cleanup) => (
                    <tr key={cleanup.ran_at}>
                      <td>{fmtFullDate(cleanup.ran_at)}</td>
                      <td className="muted">{fmtFullDate(cleanup.cutoff)}</td>
                      <td className="num">{fmtCount(cleanup.ping_rows)}</td>
                      <td className="num">{fmtCount(cleanup.outage_rows)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
