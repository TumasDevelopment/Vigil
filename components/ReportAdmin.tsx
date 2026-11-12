"use client";

import { regenerateReportAction } from "@/lib/actions-enterprise";
import { fmtBytes, fmtCount, fmtDateTime, fmtUptime } from "@/lib/format";
import type { ReportRow } from "@/lib/queries-enterprise";
import { FormNotices, SubmitButton, useFormAction } from "./forms";
import { IconDownload } from "./icons";
import { LocalTime } from "./LocalTime";

export function ReportAdmin({
  reports,
  current,
  currentLabel,
  lastClosed,
}: {
  reports: ReportRow[];
  current: string;
  currentLabel: string;
  lastClosed: string;
}) {
  const { state, pending, onSubmit } = useFormAction(regenerateReportAction);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h1>Report</h1>
          <p>Un PDF per mese: disponibilità, interruzioni, settori e servizi. Si genera da solo il primo del mese.</p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <a className="btn" href={`/api/report/${current}.pdf`}>
            <IconDownload />
            {currentLabel} finora
          </a>
        </div>
      </header>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Mesi chiusi</h2>
        </div>
        {reports.length === 0 ? (
          <div className="empty">
            Ancora nessun report salvato. Il primo arriva all&apos;inizio del prossimo mese; intanto puoi scaricare il mese
            in corso o generarne uno qui sotto.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Mese</th>
                  <th className="num">Disponibilità</th>
                  <th className="num">Interruzioni</th>
                  <th className="num">Host</th>
                  <th>Generato</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.month}>
                    <td>
                      <span className="cell-main">{report.label}</span>
                      <span className="cell-sub">{fmtBytes(report.bytes)}</span>
                    </td>
                    <td className="num">{fmtUptime(report.availability)}</td>
                    <td className="num">{report.outages === null ? "—" : fmtCount(report.outages)}</td>
                    <td className="num">{report.hosts === null ? "—" : fmtCount(report.hosts)}</td>
                    <td className="muted nowrap">
                      <LocalTime seconds={report.createdAt} format={fmtDateTime} />
                    </td>
                    <td className="actions">
                      <a className="btn btn--small" href={`/api/report/${report.month}.pdf`}>
                        <IconDownload />
                        PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel narrow">
        <div className="panel__head">
          <h2 className="panel__title">Rigenera un mese</h2>
        </div>
        <form method="post" onSubmit={onSubmit} className="form">
          <FormNotices state={state} />
          <p className="form__hint">
            Ricalcola il report di un mese chiuso e sostituisce quello salvato, per esempio dopo aver corretto una
            manutenzione. Usa lo storico ancora presente: le interruzioni restano 400 giorni.
          </p>
          <label className="field">
            <span>Mese</span>
            <input className="input" type="month" name="month" max={lastClosed} defaultValue={lastClosed} required />
          </label>
          <div className="form__actions">
            <SubmitButton pending={pending} pendingLabel="Generazione…">
              Rigenera
            </SubmitButton>
          </div>
        </form>
      </section>
    </div>
  );
}
