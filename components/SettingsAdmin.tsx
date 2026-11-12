"use client";

import Link from "next/link";
import { FormNotices, SubmitButton, useFormAction } from "@/components/forms";
import { LocalTime } from "@/components/LocalTime";
import { requestBackupAction, saveAlertSettingsAction, saveStatusSettingsAction } from "@/lib/actions-enterprise";
import { fmtBytes, fmtDateTime, fmtDuration } from "@/lib/format";
import type { AlertSettings, BackupState, StatusSettings } from "@/lib/queries-enterprise";

const TIME_ZONES = ["Europe/Rome", "Europe/Zurich", "Europe/Berlin", "Europe/Paris", "Europe/London", "UTC", "America/New_York"];

const seconds = (iso: string | null) => (iso ? Date.parse(iso) / 1000 : null);

export function SettingsAdmin({
  alerts,
  status,
  backup,
  heartbeat,
}: {
  alerts: AlertSettings;
  status: StatusSettings;
  backup: BackupState;
  heartbeat: boolean;
}) {
  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h1>Impostazioni</h1>
          <p>Avvisi notturni, escalation, pagina di stato e copie del database.</p>
        </div>
      </header>
      <AlertSettingsForm settings={alerts} />
      <StatusSettingsForm settings={status} />
      <BackupPanel backup={backup} />
      <HealthPanel heartbeat={heartbeat} />
    </div>
  );
}

function AlertSettingsForm({ settings }: { settings: AlertSettings }) {
  const { state, pending, onSubmit } = useFormAction(saveAlertSettingsAction);
  return (
    <section className="panel narrow narrow--wide">
      <div className="panel__head">
        <h2 className="panel__title">Avvisi</h2>
      </div>
      <form method="post" onSubmit={onSubmit} className="form">
        <FormNotices state={state} />
        <label className="check">
          <input type="checkbox" name="quietEnabled" defaultChecked={settings.quietEnabled} />
          Ore di silenzio per gli host non critici
        </label>
        <p className="form__hint">
          Nelle ore di silenzio gli avvisi degli host non segnati come <b>critici</b> restano nello storico ma non
          arrivano sui dispositivi. Alla fine del silenzio arriva un riepilogo di ciò che è ancora guasto.
        </p>
        <div className="form__row form__row--three">
          <label className="field">
            <span>Dalle</span>
            <input className="input" type="time" name="quietFrom" defaultValue={settings.quietFrom} required />
          </label>
          <label className="field">
            <span>Alle</span>
            <input className="input" type="time" name="quietTo" defaultValue={settings.quietTo} required />
          </label>
          <label className="field">
            <span>Fuso orario</span>
            <input
              className="input"
              name="timeZone"
              list="vigil-time-zones"
              defaultValue={settings.timeZone}
              spellCheck={false}
              required
            />
            <datalist id="vigil-time-zones">
              {TIME_ZONES.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </label>
        </div>
        <div className="form__row">
          <label className="field">
            <span>Escalation dopo (minuti)</span>
            <input
              className="input"
              type="number"
              name="escalationMinutes"
              min={0}
              max={1440}
              defaultValue={settings.escalationMinutes}
              required
            />
            <small>
              Un guasto non preso in carico sale di livello e avvisa gli utenti di livello 2, poi 3. 0 = mai.
            </small>
          </label>
          <label className="field">
            <span>Garanzie: avviso con giorni di anticipo</span>
            <input
              className="input"
              type="number"
              name="warrantyDays"
              min={1}
              max={365}
              defaultValue={settings.warrantyDays}
              required
            />
            <small>Vale per le date di fine garanzia scritte nell&apos;inventario.</small>
          </label>
        </div>
        <div className="form__actions">
          <SubmitButton pending={pending}>Salva</SubmitButton>
        </div>
      </form>
    </section>
  );
}

function StatusSettingsForm({ settings }: { settings: StatusSettings }) {
  const { state, pending, onSubmit } = useFormAction(saveStatusSettingsAction);
  return (
    <section className="panel narrow narrow--wide">
      <div className="panel__head">
        <h2 className="panel__title">Pagina di stato</h2>
        {settings.enabled && (
          <Link className="btn btn--small btn--ghost" href="/stato" target="_blank">
            Apri /stato
          </Link>
        )}
      </div>
      <form method="post" onSubmit={onSubmit} className="form">
        <FormNotices state={state} />
        <label className="check">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} />
          Pagina /stato attiva, senza accesso
        </label>
        <p className="form__hint">
          Mostra solo gli host con un <b>nome pubblico</b> (si imposta nella scheda dell&apos;host), il loro stato e le
          interruzioni degli ultimi 30 giorni. Niente indirizzi, settori o note interne.
        </p>
        <label className="field">
          <span>Titolo</span>
          <input className="input" name="title" maxLength={80} defaultValue={settings.title} placeholder="Stato dei servizi" />
        </label>
        <label className="field">
          <span>Avviso in cima</span>
          <textarea className="textarea" name="note" maxLength={500} rows={3} defaultValue={settings.note} />
          <small>Facoltativo, per esempio un lavoro programmato. Al massimo 500 caratteri.</small>
        </label>
        <div className="form__actions">
          <SubmitButton pending={pending}>Salva</SubmitButton>
        </div>
      </form>
    </section>
  );
}

function BackupPanel({ backup }: { backup: BackupState }) {
  const { state, pending, onSubmit } = useFormAction(requestBackupAction);
  const waiting = backup.running || backup.requestPending || Boolean(state?.ok);
  return (
    <section className="panel narrow narrow--wide">
      <div className="panel__head">
        <h2 className="panel__title">Backup del database</h2>
      </div>
      <div className="form">
        <FormNotices state={state} />
        {!backup.pgDump && (
          <div className="notice notice--error" role="alert">
            pg_dump non trovato sul server: il backup automatico è fermo.
          </div>
        )}
        {backup.error && (
          <div className="notice notice--error" role="alert">
            Ultimo tentativo fallito: {backup.error}
          </div>
        )}
        <dl className="facts">
          <dt>Ultima copia riuscita</dt>
          <dd>
            <LocalTime seconds={seconds(backup.lastSuccessAt)} format={fmtDateTime} />
            {backup.bytes !== null && ` · ${fmtBytes(backup.bytes)}`}
            {backup.durationMs !== null && ` · ${fmtDuration(Math.max(1, Math.round(backup.durationMs / 1000)))}`}
          </dd>
          <dt>Ultimo tentativo</dt>
          <dd>
            <LocalTime seconds={seconds(backup.lastAttemptAt)} format={fmtDateTime} />
          </dd>
          <dt>Cartella</dt>
          <dd className="mono">{backup.dir ?? "—"}</dd>
          <dt>Copie tenute</dt>
          <dd>{backup.keep ?? "—"}</dd>
        </dl>
        <p className="form__hint">
          Una copia al giorno con <b>pg_dump</b>, controllata con pg_restore. Restano sulla stessa macchina: copiale
          altrove (un altro server o un disco), altrimenti un guasto del disco le perde insieme al database.
        </p>
        {backup.files.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Data</th>
                  <th className="num">Dimensione</th>
                </tr>
              </thead>
              <tbody>
                {backup.files.map((file) => (
                  <tr key={file.name}>
                    <td className="mono">{file.name}</td>
                    <td>
                      <LocalTime seconds={seconds(file.at)} format={fmtDateTime} />
                    </td>
                    <td className="num">{fmtBytes(file.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form method="post" onSubmit={onSubmit} className="form__actions">
          <SubmitButton pending={pending || waiting} pendingLabel={waiting ? "In coda…" : "Invio…"}>
            Esegui ora
          </SubmitButton>
        </form>
      </div>
    </section>
  );
}

function HealthPanel({ heartbeat }: { heartbeat: boolean }) {
  return (
    <section className="panel narrow narrow--wide">
      <div className="panel__head">
        <h2 className="panel__title">Chi controlla Vigil</h2>
      </div>
      <div className="form">
        <p className="form__hint">
          <b>/api/salute</b> risponde senza accesso: 200 se database e controllo funzionano, 503 altrimenti. Puoi farlo
          interrogare da un servizio esterno.
        </p>
        <p className="form__hint">
          Con <b>HEARTBEAT_URL</b> nel file .env, il controllo chiama quell&apos;indirizzo a ogni giro riuscito: se
          smette, il servizio esterno avvisa (funziona anche se cade tutta la macchina).
        </p>
        <div className={`notice ${heartbeat ? "notice--ok" : "notice--hint"}`}>
          {heartbeat ? "HEARTBEAT_URL è impostato." : "HEARTBEAT_URL non è impostato."}
        </div>
      </div>
    </section>
  );
}
