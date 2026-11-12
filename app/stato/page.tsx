import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LocalTime } from "@/components/LocalTime";
import { fmtDay, fmtDuration, fmtUptime } from "@/lib/format";
import { getStatusPage, type PublicStatus, type StatusComponent } from "@/lib/queries-enterprise";

export const dynamic = "force-dynamic";

const LABEL: Record<PublicStatus, string> = {
  up: "Operativo",
  degraded: "Prestazioni ridotte",
  down: "Non disponibile",
  maintenance: "In manutenzione",
  unknown: "Stato sconosciuto",
};

const OVERALL: Record<PublicStatus, string> = {
  up: "Tutti i servizi sono operativi",
  degraded: "Alcuni servizi hanno problemi",
  down: "Disservizio in corso",
  maintenance: "Manutenzione in corso",
  unknown: "Stato non disponibile al momento",
};

/** Un giorno sopra i 5 minuti di fermo è rosso, sotto è giallo. */
const MINOR = 300;

export async function generateMetadata(): Promise<Metadata> {
  const page = await getStatusPage();
  return { title: page?.title ?? "Stato", robots: { index: false, follow: false } };
}

function DayBars({ component, labels }: { component: StatusComponent; labels: string[] }) {
  return (
    <div className="status-bars" role="img" aria-label={`Ultimi ${labels.length} giorni`}>
      {component.days.map((down, index) => {
        const day = labels[index];
        const tone = index < component.from ? "none" : down <= 0 ? "up" : down < MINOR ? "minor" : "major";
        const text =
          tone === "none"
            ? "nessun dato"
            : down <= 0
              ? "nessuna interruzione"
              : `fuori servizio ${fmtDuration(down)}`;
        return <span key={day} className={`status-bar status-bar--${tone}`} title={`${fmtDay(day)} · ${text}`} />;
      })}
    </div>
  );
}

export default async function StatusPage() {
  const page = await getStatusPage();
  if (!page) notFound();

  const open = page.incidents.filter((incident) => incident.ended === null);
  const closed = page.incidents.filter((incident) => incident.ended !== null);
  const now = page.generatedAt;

  return (
    <main className="status-page">
      <AutoRefresh seconds={60} />
      <header className="status-page__head">
        <h1>{page.title}</h1>
        {page.note && <p className="status-page__note">{page.note}</p>}
      </header>

      <section className={`status-banner status--${page.overall}`}>
        <i aria-hidden="true" />
        <div>
          <strong>{OVERALL[page.overall]}</strong>
          <span>
            Aggiornato alle <LocalTime seconds={page.generatedAt} format="time" />
          </span>
        </div>
      </section>

      {page.maintenance.length > 0 && (
        <section className="status-section">
          <h2>Manutenzioni</h2>
          <ul className="status-list">
            {page.maintenance.map((window) => (
              <li key={`${window.starts}-${window.labels.join()}`} className="status-list__item">
                <span className={`status-pill status--maintenance`}>{window.starts <= now ? "In corso" : "Prevista"}</span>
                <div>
                  <strong>{window.labels.join(", ")}</strong>
                  <span className="status-list__sub">
                    <LocalTime seconds={window.starts} format="dateTime" /> → <LocalTime seconds={window.ends} format="dateTime" />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="status-section">
        <div className="status-section__head">
          <h2>Servizi</h2>
          <span className="status-legend">
            <span className="status-bar status-bar--up" /> regolare
            <span className="status-bar status-bar--minor" /> breve
            <span className="status-bar status-bar--major" /> fermo
          </span>
        </div>
        {page.components.length === 0 ? (
          <p className="status-empty">Nessun servizio pubblicato.</p>
        ) : (
          <ul className="status-components">
            {page.components.map((component) => (
              <li key={component.id} className="status-component">
                <div className="status-component__head">
                  <strong>{component.label}</strong>
                  <span className={`status-pill status--${component.status}`}>{LABEL[component.status]}</span>
                </div>
                <DayBars component={component} labels={page.dayLabels} />
                <div className="status-component__foot">
                  <span>{page.dayLabels.length} giorni fa</span>
                  <span>{component.uptime === null ? "Storico non ancora disponibile" : `${fmtUptime(component.uptime)} disponibile`}</span>
                  <span>Oggi</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="status-section">
        <h2>Interruzioni degli ultimi 7 giorni</h2>
        {page.incidents.length === 0 ? (
          <p className="status-empty">Nessuna interruzione.</p>
        ) : (
          <ul className="status-list">
            {[...open, ...closed].map((incident) => (
              <li key={`${incident.label}-${incident.started}`} className="status-list__item">
                <span className={`status-pill status--${incident.ended === null ? "down" : "up"}`}>
                  {incident.ended === null ? "In corso" : "Risolta"}
                </span>
                <div>
                  <strong>{incident.label}</strong>
                  <span className="status-list__sub">
                    Dalle <LocalTime seconds={incident.started} format="dateTime" />
                    {incident.ended === null ? (
                      <> · da {fmtDuration(now - incident.started)}</>
                    ) : (
                      <> · durata {fmtDuration(incident.ended - incident.started)}</>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="status-page__foot">Si aggiorna da sola ogni minuto · Vigil</footer>
    </main>
  );
}
