import { requireAdmin } from "@/lib/auth";
import { fmtBytes, fmtCount, fmtFullDate } from "@/lib/format";
import { getSystemInfo } from "@/lib/queries";
import type { SystemFacts } from "@/lib/types";

export const metadata = { title: "Sistema · Vigil" };

const orDash = (value: string | null | undefined) => value || "—";

function osVersion(os: SystemFacts["os"]) {
  if (!os.version) return "—";
  return os.codename && !os.version.toLowerCase().includes(os.codename) ? `${os.version} (${os.codename})` : os.version;
}

function hardwareText({ vendor, product }: SystemFacts["hardware"]) {
  if (vendor && product) return product.startsWith(vendor) ? product : `${vendor} ${product}`;
  return orDash(vendor ?? product);
}

function ServerFacts({ facts, at }: { facts: SystemFacts; at: number | null }) {
  return (
    <>
      <div className="grid-2 grid-2--even">
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Sistema operativo</h2>
          </div>
          <dl className="facts">
            <dt>Sistema</dt>
            <dd>{orDash(facts.os.name)}</dd>
            <dt>Versione</dt>
            <dd className="num">{osVersion(facts.os)}</dd>
            <dt>Kernel</dt>
            <dd className="num">{facts.os.kernel}</dd>
            <dt>Architettura</dt>
            <dd className="num">{facts.os.arch}</dd>
            <dt>Nome host</dt>
            <dd className="num">{facts.hostname}</dd>
            <dt>Fuso orario</dt>
            <dd>{orDash(facts.timezone)}</dd>
            <dt>Acceso dal</dt>
            <dd>{fmtFullDate(facts.bootedAt)}</dd>
          </dl>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Hardware</h2>
          </div>
          <dl className="facts">
            <dt>Macchina</dt>
            <dd>{hardwareText(facts.hardware)}</dd>
            <dt>Virtualizzazione</dt>
            <dd>{orDash(facts.hardware.virtualization)}</dd>
            <dt>Processore</dt>
            <dd>{orDash(facts.cpu.model)}</dd>
            <dt>Core</dt>
            <dd className="num">{facts.cpu.cores}</dd>
            <dt>Memoria</dt>
            <dd className="num">{fmtBytes(facts.memTotal)}</dd>
            <dt>Swap</dt>
            <dd className="num">{facts.swapTotal > 0 ? fmtBytes(facts.swapTotal) : "Assente"}</dd>
            <dt>Disco di sistema</dt>
            <dd className="num">{fmtBytes(facts.diskTotal)}</dd>
          </dl>
        </section>
      </div>

      <div className="grid-2 grid-2--even">
        <section className="panel">
          <div className="panel__head">
            <div>
              <h2 className="panel__title">Rete</h2>
              <p className="panel__sub">Da qui partono i ping e le ricerche dei dispositivi.</p>
            </div>
          </div>
          <dl className="facts" style={{ marginBottom: 14 }}>
            <dt>Gateway</dt>
            <dd className="num">
              {facts.network.gateway ? `${facts.network.gateway.address} (${facts.network.gateway.iface})` : "—"}
            </dd>
            <dt>Server DNS</dt>
            <dd className="num">{facts.network.dns.length > 0 ? facts.network.dns.join(", ") : "—"}</dd>
          </dl>
          {facts.network.cards.length === 0 ? (
            <div className="empty">Nessuna scheda di rete trovata.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Scheda</th>
                    <th>Indirizzi</th>
                    <th>MAC</th>
                  </tr>
                </thead>
                <tbody>
                  {facts.network.cards.map((card) => (
                    <tr key={card.name}>
                      <td className="num">{card.name}</td>
                      <td className="num">
                        {card.addresses.map((address) => (
                          <div key={address}>{address}</div>
                        ))}
                      </td>
                      <td className="num muted">{orDash(card.mac)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Software</h2>
          </div>
          <dl className="facts">
            <dt>Vigil</dt>
            <dd className="num">{orDash(facts.software.vigil)}</dd>
            <dt>Node.js</dt>
            <dd className="num">{facts.software.node}</dd>
            <dt>Next.js</dt>
            <dd className="num">{orDash(facts.software.next)}</dd>
            <dt>ping</dt>
            <dd className="num">{facts.software.ping ?? "Non trovato: i ping non funzionano"}</dd>
            <dt>nginx</dt>
            <dd className="num">{facts.software.nginx ?? "Non installato"}</dd>
            <dt>Elenco produttori MAC</dt>
            <dd>
              {facts.ouiUpdatedAt === null
                ? "Assente: la ricerca non mostra i produttori (pacchetto ieee-data)"
                : `Aggiornato al ${fmtFullDate(facts.ouiUpdatedAt)}`}
            </dd>
            <dt>Worker avviato il</dt>
            <dd>{fmtFullDate(facts.workerStartedAt)}</dd>
          </dl>
        </section>
      </div>

      <p className="form__hint">
        Dati letti dal servizio di ping all&apos;avvio e ogni 6 ore. Ultima lettura: {fmtFullDate(at)}.
      </p>
    </>
  );
}

export default async function SystemPage() {
  await requireAdmin();
  const info = await getSystemInfo();

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Sistema</h1>
          <p>Il server, la salute del servizio di ping e la pulizia dei dati</p>
        </div>
      </header>

      <div className="stack">
        {info.facts ? (
          <ServerFacts facts={info.facts} at={info.factsAt} />
        ) : (
          <section className="panel">
            <div className="empty">
              Il servizio di ping non ha ancora letto i dati del server: compariranno al suo prossimo avvio.
            </div>
          </section>
        )}

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
              <dt>PostgreSQL</dt>
              <dd className="num">{info.database.version}</dd>
              <dt>Avviato il</dt>
              <dd>{fmtFullDate(info.database.started_at)}</dd>
              <dt>Fuso orario</dt>
              <dd>{info.database.timezone}</dd>
              <dt>Connessioni</dt>
              <dd className="num">
                {fmtCount(info.database.connections)} su {fmtCount(info.database.max_connections)}
              </dd>
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
