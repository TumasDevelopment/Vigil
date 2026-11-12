"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  bulkUpdateHostsAction,
  deleteHostAction,
  saveHostAction,
  saveTypeThresholdsAction,
  toggleHostAction,
} from "@/lib/actions";
import { importHostsCsvAction } from "@/lib/actions-enterprise";
import { INVENTORY_FIELDS, type InventoryKey } from "@/lib/form";
import type { ImportPreview, ImportRow } from "@/lib/host-csv";
import { ALL_FILTER, DEVICE_TYPES, deviceLabel, groupHosts, type DeviceType } from "@/lib/scope";
import { DeviceIcon } from "./DeviceIcon";
import { ConfirmSubmit, Modal, SubmitButton, useFormAction } from "./forms";
import { IconDownload, IconPlus } from "./icons";
import { FilterSelect } from "./Toolbar";

export interface AdminHost {
  id: number;
  name: string;
  address: string;
  group_name: string;
  device_type: DeviceType;
  enabled: boolean;
  ping_enabled: boolean;
  latency_warn_ms: number | null;
  loss_warn_pct: number | null;
  parent_id: number | null;
  critical: boolean;
  public_label: string | null;
  manufacturer: string | null;
  model: string | null;
  serial: string | null;
  firmware: string | null;
  location: string | null;
  owner: string | null;
  inventory_note: string | null;
  purchased_on: string | null;
  warranty_until: string | null;
}

/** Il valore salvato di un campo dell'inventario, dal nome del campo nel modulo. */
const inventoryValue = (host: AdminHost | null, key: InventoryKey) =>
  host?.[key === "inventoryNote" ? "inventory_note" : key] ?? "";

const INVENTORY_HINT: Partial<Record<InventoryKey, string>> = {
  manufacturer: "Ubiquiti, HP, Siemens…",
  location: "Armadio rack piano terra",
  owner: "Chi se ne occupa",
};

export interface TypeThreshold {
  device_type: DeviceType;
  latency_warn_ms: number | null;
  loss_warn_pct: number | null;
}

function SectorOptions({ id, sectors }: { id: string; sectors: string[] }) {
  return (
    <datalist id={id}>
      {sectors.map((sector) => (
        <option key={sector} value={sector} />
      ))}
    </datalist>
  );
}

/** L'host e chi dipende da lui: collegandolo a uno di questi si chiuderebbe un cerchio. */
function withDependents(id: number, hosts: AdminHost[]) {
  const found = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const host of hosts) {
      if (host.parent_id !== null && found.has(host.parent_id) && !found.has(host.id)) {
        found.add(host.id);
        grew = true;
      }
    }
  }
  return found;
}

function HostForm({
  host,
  hosts,
  sectors,
  onDone,
}: {
  host: AdminHost | null;
  hosts: AdminHost[];
  sectors: string[];
  onDone: () => void;
}) {
  const { state, pending, onSubmit } = useFormAction(saveHostAction);
  const blocked = host ? withDependents(host.id, hosts) : new Set<number>();

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form onSubmit={onSubmit} className="form">
      {host && <input type="hidden" name="id" value={host.id} />}
      {state?.error && (
        <div className="notice notice--error" role="alert">
          {state.error}
        </div>
      )}
      <label className="field">
        <span>Nome</span>
        <input className="input" name="name" defaultValue={host?.name} maxLength={80} required autoFocus />
      </label>
      <label className="field">
        <span>Indirizzo IP o nome host</span>
        <input className="input" name="address" defaultValue={host?.address} placeholder="192.168.1.1" required />
        {host && <small>Cambiando indirizzo, lo stato attuale riparte da zero.</small>}
      </label>
      <div className="form__row">
        <label className="field">
          <span>Settore (facoltativo)</span>
          <input
            className="input"
            name="sector"
            defaultValue={host?.group_name}
            maxLength={40}
            list="host-sectors"
            placeholder="Produzione, Uffici…"
          />
          <SectorOptions id="host-sectors" sectors={sectors} />
        </label>
        <label className="field">
          <span>Tipo di dispositivo</span>
          <select className="select" name="type" defaultValue={host?.device_type ?? "altro"}>
            {DEVICE_TYPES.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Controllo con il ping</span>
        <select className="select" name="ping" defaultValue={host?.ping_enabled === false ? "false" : "true"}>
          <option value="true">Sì</option>
          <option value="false">No, il dispositivo blocca il ping</option>
        </select>
        <small>Senza ping, lo stato dipende dai controlli su porte e siti aggiunti in Servizi.</small>
      </label>
      <label className="field">
        <span>Collegato a (facoltativo)</span>
        <select className="select" name="parent" defaultValue={host?.parent_id ?? ""}>
          <option value="">Nessuno</option>
          {hosts
            .filter((item) => !blocked.has(item.id))
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
        <small>
          Il dispositivo da cui passa, per esempio lo switch. Se cade quello, questo risulta Non raggiungibile e arriva
          un solo avviso.
        </small>
      </label>
      <div className="form__row">
        <label className="field">
          <span>Instabile oltre (ms)</span>
          <input
            className="input"
            name="latencyWarn"
            inputMode="decimal"
            defaultValue={host?.latency_warn_ms ?? ""}
            placeholder="Come il tipo"
          />
        </label>
        <label className="field">
          <span>Instabile oltre (% persi)</span>
          <input
            className="input"
            name="lossWarn"
            inputMode="decimal"
            defaultValue={host?.loss_warn_pct ?? ""}
            placeholder="Come il tipo"
          />
        </label>
      </div>
      <p className="form__hint">Valgono sulla media dell'ultimo minuto e hanno la precedenza sulle soglie del tipo.</p>
      <label className="check">
        <input type="checkbox" name="critical" defaultChecked={host?.critical ?? false} />
        Critico: avvisa anche nelle ore di silenzio
      </label>
      <label className="field">
        <span>Nome sulla pagina di stato (facoltativo)</span>
        <input
          className="input"
          name="publicLabel"
          defaultValue={host?.public_label ?? ""}
          maxLength={80}
          placeholder="Vuoto: non compare"
        />
        <small>Chi apre la pagina di stato vede solo questo nome, mai l&apos;indirizzo.</small>
      </label>
      <details className="form__more" open={INVENTORY_FIELDS.some((field) => inventoryValue(host, field.key)) || undefined}>
        <summary>Inventario</summary>
        <div className="form__grid">
          {INVENTORY_FIELDS.filter((field) => field.key !== "inventoryNote").map((field) => (
            <label key={field.key} className="field">
              <span>{field.label.replace(/^(Il|La|Lo|L') ?/, "").replace(/^./, (c) => c.toUpperCase())}</span>
              <input
                className="input"
                name={field.key}
                defaultValue={inventoryValue(host, field.key)}
                maxLength={field.max}
                placeholder={INVENTORY_HINT[field.key]}
              />
            </label>
          ))}
          <label className="field">
            <span>Data di acquisto</span>
            <input className="input" type="date" name="purchasedOn" defaultValue={host?.purchased_on ?? ""} />
          </label>
          <label className="field">
            <span>Fine garanzia</span>
            <input className="input" type="date" name="warrantyUntil" defaultValue={host?.warranty_until ?? ""} />
          </label>
        </div>
        <label className="field">
          <span>Note</span>
          <textarea className="textarea" name="inventoryNote" defaultValue={host?.inventory_note ?? ""} maxLength={500} />
        </label>
      </details>
      <div className="form__actions">
        <button type="button" className="btn" onClick={onDone}>
          Annulla
        </button>
        <SubmitButton pending={pending}>Salva</SubmitButton>
      </div>
    </form>
  );
}

function ThresholdsForm({ thresholds, onDone }: { thresholds: TypeThreshold[]; onDone: () => void }) {
  const { state, pending, onSubmit } = useFormAction(saveTypeThresholdsAction);

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form onSubmit={onSubmit} className="form">
      {state?.error && (
        <div className="notice notice--error" role="alert">
          {state.error}
        </div>
      )}
      <p className="form__hint">
        Un dispositivo diventa Instabile quando la media dell'ultimo minuto supera la soglia. Senza soglia di perdita
        basta un ping perso; senza soglia di latenza la latenza non conta.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Latenza oltre (ms)</th>
              <th>Persi oltre (%)</th>
            </tr>
          </thead>
          <tbody>
            {DEVICE_TYPES.map((type) => {
              const saved = thresholds.find((item) => item.device_type === type.key);
              return (
                <tr key={type.key}>
                  <td className="nowrap">
                    <DeviceIcon type={type.key} /> {type.label}
                  </td>
                  <td>
                    <input
                      className="input input--number"
                      name={`latency-${type.key}`}
                      inputMode="decimal"
                      aria-label={`${type.label}: latenza massima in millisecondi`}
                      defaultValue={saved?.latency_warn_ms ?? ""}
                    />
                  </td>
                  <td>
                    <input
                      className="input input--number"
                      name={`loss-${type.key}`}
                      inputMode="decimal"
                      aria-label={`${type.label}: percentuale massima di ping persi`}
                      defaultValue={saved?.loss_warn_pct ?? ""}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="form__actions">
        <button type="button" className="btn" onClick={onDone}>
          Annulla
        </button>
        <SubmitButton pending={pending}>Salva</SubmitButton>
      </div>
    </form>
  );
}

const ACTION_BADGE: Record<ImportRow["action"], { label: string; tone: string }> = {
  create: { label: "Nuovo", tone: "online" },
  update: { label: "Aggiorna", tone: "maintenance" },
  skip: { label: "Saltato", tone: "paused" },
  error: { label: "Errore", tone: "offline" },
};

const PREVIEW_MAX = 300;

/**
 * Import in due tempi: il primo invio legge il file e mostra cosa succederebbe riga per riga,
 * il secondo (con confirm=1) lo applica. Se nel frattempo il modulo cambia, l'anteprima non vale più.
 */
function ImportForm({ onDone }: { onDone: () => void }) {
  const { state, pending, submit } = useFormAction(importHostsCsvAction);
  const form = useRef<HTMLFormElement>(null);
  const [staleAt, setStaleAt] = useState<typeof state>(undefined);

  const preview = state?.data as ImportPreview | undefined;
  const fresh = Boolean(preview) && staleAt !== state;
  const ready = fresh && preview && !preview.applied && preview.counts.create + preview.counts.update > 0;

  useEffect(() => {
    if (preview?.applied) form.current?.reset();
  }, [preview]);

  function send(confirm: boolean) {
    if (!form.current) return;
    const data = new FormData(form.current);
    if (confirm) data.set("confirm", "1");
    submit(data);
  }

  return (
    <form
      ref={form}
      onSubmit={(event) => {
        event.preventDefault();
        send(false);
      }}
      onChange={() => setStaleAt(state)}
      className="form"
    >
      {state?.error && (
        <div className="notice notice--error" role="alert">
          {state.error}
        </div>
      )}
      {state?.message && (
        <div className="notice notice--ok" role="status">
          {state.message}
        </div>
      )}
      <p className="form__hint">
        La prima riga contiene i nomi delle colonne: <b>Indirizzo</b> è obbligatoria, le altre (Nome, Settore, Tipo,
        Collegato a, Critico, inventario…) sono facoltative. Il modo più semplice: <a href="/api/host.csv">scarica
        l&apos;export</a>, modificalo e reimportalo. Separatori ammessi: punto e virgola, virgola o tab.
      </p>
      <label className="field">
        <span>File CSV</span>
        <input className="input" type="file" name="file" accept=".csv,text/csv,text/plain" />
      </label>
      <label className="field">
        <span>Oppure incolla il testo</span>
        <textarea
          className="textarea"
          name="csv"
          placeholder={"Nome;Indirizzo;Settore;Tipo\nGateway;192.168.1.254;Rete;router\nStampante ufficio;192.168.1.40;Uffici;stampante"}
        />
      </label>
      <fieldset className="field">
        <span>Host con un indirizzo già presente</span>
        <label className="check">
          <input type="radio" name="mode" value="new" defaultChecked />
          Saltali: aggiungi solo quelli nuovi
        </label>
        <label className="check">
          <input type="radio" name="mode" value="update" />
          Aggiornali con i valori del file (le colonne assenti restano come sono)
        </label>
      </fieldset>

      {fresh && preview && (
        <div className="import-preview">
          <div className="import-preview__counts">
            {(Object.keys(ACTION_BADGE) as ImportRow["action"][]).map((action) =>
              preview.counts[action] > 0 ? (
                <span key={action} className={`badge badge--${ACTION_BADGE[action].tone}`}>
                  {ACTION_BADGE[action].label}: {preview.counts[action]}
                </span>
              ) : null,
            )}
            {preview.applied && <span className="muted">Importazione eseguita.</span>}
          </div>
          {preview.ignored.length > 0 && (
            <p className="form__hint">
              Colonne ignorate perché sconosciute: <b>{preview.ignored.join(", ")}</b>
            </p>
          )}
          <div className="table-wrap import-preview__table">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>Riga</th>
                  <th>Host</th>
                  <th>Esito</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, PREVIEW_MAX).map((row) => (
                  <tr key={row.line}>
                    <td className="num">{row.line}</td>
                    <td>
                      <span className="cell-main">{row.name || "—"}</span>
                      <span className="cell-sub mono">{row.address || "—"}</span>
                    </td>
                    <td>
                      <span className={`badge badge--${ACTION_BADGE[row.action].tone}`}>
                        {ACTION_BADGE[row.action].label}
                      </span>
                    </td>
                    <td className="muted">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > PREVIEW_MAX && (
            <p className="form__hint">Mostrate le prime {PREVIEW_MAX} righe di {preview.rows.length}.</p>
          )}
        </div>
      )}

      <div className="form__actions">
        <button type="button" className="btn" onClick={onDone}>
          Chiudi
        </button>
        {ready ? (
          <button type="button" className="btn btn--primary" disabled={pending} onClick={() => send(true)}>
            {pending
              ? "Importazione…"
              : `Importa ${preview.counts.create + preview.counts.update} host`}
          </button>
        ) : (
          <SubmitButton pending={pending} pendingLabel="Lettura…">
            Anteprima
          </SubmitButton>
        )}
      </div>
    </form>
  );
}

function BulkBar({
  ids,
  hosts,
  sectors,
  onClear,
}: {
  ids: number[];
  hosts: AdminHost[];
  sectors: string[];
  onClear: () => void;
}) {
  const { state, pending, onSubmit } = useFormAction(bulkUpdateHostsAction);

  useEffect(() => {
    if (state?.ok) onClear();
  }, [state, onClear]);

  return (
    <form className="bulk" onSubmit={onSubmit}>
      {ids.map((id) => (
        <input key={id} type="hidden" name="id" value={id} />
      ))}
      <span className="bulk__count">{ids.length === 1 ? "1 host selezionato" : `${ids.length} host selezionati`}</span>
      <input
        className="input"
        name="sector"
        maxLength={40}
        list="bulk-sectors"
        aria-label="Nuovo settore"
        placeholder="Settore: lascia com'è"
      />
      <SectorOptions id="bulk-sectors" sectors={sectors} />
      <select className="select" name="type" aria-label="Nuovo tipo" defaultValue="">
        <option value="">Tipo: lascia com'è</option>
        {DEVICE_TYPES.map((type) => (
          <option key={type.key} value={type.key}>
            {type.label}
          </option>
        ))}
      </select>
      <select className="select" name="parent" aria-label="Nuovo collegamento" defaultValue="">
        <option value="">Collegato a: lascia com'è</option>
        <option value="none">Nessun collegamento</option>
        {hosts
          .filter((host) => !ids.includes(host.id))
          .map((host) => (
            <option key={host.id} value={host.id}>
              {host.name}
            </option>
          ))}
      </select>
      <SubmitButton pending={pending}>Applica</SubmitButton>
      <button type="button" className="btn" onClick={onClear}>
        Annulla
      </button>
      {state?.error && (
        <div className="notice notice--error" role="alert">
          {state.error}
        </div>
      )}
    </form>
  );
}

export function HostAdmin({ hosts, thresholds }: { hosts: AdminHost[]; thresholds: TypeThreshold[] }) {
  const [editing, setEditing] = useState<AdminHost | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [limits, setLimits] = useState(false);
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState(ALL_FILTER);
  const [type, setType] = useState(ALL_FILTER);
  const [picked, setPicked] = useState<number[]>([]);

  const rows = useMemo(() => hosts.map((host) => ({ ...host, sector: host.group_name, type: host.device_type })), [hosts]);
  const sectorOptions = useMemo(() => groupHosts(rows, "sector"), [rows]);
  const typeOptions = useMemo(() => groupHosts(rows, "type"), [rows]);
  const sectors = sectorOptions.map((option) => option.key).filter(Boolean);
  const names = useMemo(() => new Map(hosts.map((host) => [host.id, host.name])), [hosts]);

  const needle = search.trim().toLowerCase();
  const shown = rows
    .filter((host) => sector === ALL_FILTER || host.sector === sector)
    .filter((host) => type === ALL_FILTER || host.type === type)
    .filter(
      (host) =>
        !needle || host.name.toLowerCase().includes(needle) || host.address.toLowerCase().includes(needle),
    );

  // La selezione riguarda solo le righe a schermo: si modifica solo ciò che si vede
  const pickedIds = shown.filter((host) => picked.includes(host.id)).map((host) => host.id);
  const allPicked = shown.length > 0 && pickedIds.length === shown.length;

  const closeEditor = () => setEditing(null);
  const closeImport = () => setImporting(false);
  const closeLimits = () => setLimits(false);
  const clearPicked = () => setPicked([]);

  function togglePicked(id: number) {
    setPicked(picked.includes(id) ? picked.filter((item) => item !== id) : [...picked, id]);
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Host</h1>
          <p>
            {hosts.length} dispositivi. Ogni 10 secondi il server invia 3 ping a ciascuno di quelli attivi.
          </p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button type="button" className="btn" onClick={() => setLimits(true)}>
            Soglie per tipo
          </button>
          <button type="button" className="btn" onClick={() => setImporting(true)}>
            Importa CSV
          </button>
          <a className="btn" href="/api/host.csv">
            <IconDownload />
            Esporta CSV
          </a>
          <button type="button" className="btn btn--primary" onClick={() => setEditing("new")}>
            <IconPlus />
            Nuovo host
          </button>
        </div>
      </header>

      {hosts.length > 0 && (
        <div className="toolbar">
          <input
            className="input"
            type="search"
            placeholder="Cerca nome o IP"
            aria-label="Cerca host"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {sectorOptions.length > 1 && (
            <FilterSelect
              label="Settore"
              allLabel="Tutti i settori"
              value={sector}
              options={sectorOptions}
              onChange={setSector}
            />
          )}
          {typeOptions.length > 1 && (
            <FilterSelect label="Tipo" allLabel="Tutti i tipi" value={type} options={typeOptions} onChange={setType} />
          )}
        </div>
      )}

      {pickedIds.length > 0 && <BulkBar ids={pickedIds} hosts={hosts} sectors={sectors} onClear={clearPicked} />}

      <section className="panel">
        {hosts.length === 0 ? (
          <div className="empty">Nessun host. Aggiungine uno o importa un elenco.</div>
        ) : shown.length === 0 ? (
          <div className="empty">Nessun host corrisponde ai filtri.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Seleziona tutti gli host mostrati"
                      checked={allPicked}
                      onChange={() => setPicked(allPicked ? [] : shown.map((host) => host.id))}
                    />
                  </th>
                  <th>Nome</th>
                  <th>Indirizzo</th>
                  <th>Settore</th>
                  <th>Tipo</th>
                  <th>Collegato a</th>
                  <th>Monitoraggio</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((host) => (
                  <tr key={host.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Seleziona ${host.name}`}
                        checked={picked.includes(host.id)}
                        onChange={() => togglePicked(host.id)}
                      />
                    </td>
                    <td>
                      <span className="cell-main">{host.name}</span>
                    </td>
                    <td className="muted">{host.address}</td>
                    <td className="muted">{host.sector || "—"}</td>
                    <td className="muted nowrap">
                      <DeviceIcon type={host.type} /> {deviceLabel(host.type)}
                    </td>
                    <td className="muted">{host.parent_id === null ? "—" : names.get(host.parent_id)}</td>
                    <td className="nowrap">
                      {!host.enabled ? "In pausa" : host.ping_enabled ? "Attivo" : "Attivo, senza ping"}
                    </td>
                    <td className="actions">
                      <button type="button" className="btn btn--small" onClick={() => setEditing(host)}>
                        Modifica
                      </button>
                      <form action={toggleHostAction}>
                        <input type="hidden" name="id" value={host.id} />
                        <input type="hidden" name="enabled" value={String(!host.enabled)} />
                        <button type="submit" className="btn btn--small">
                          {host.enabled ? "Metti in pausa" : "Riattiva"}
                        </button>
                      </form>
                      <form action={deleteHostAction}>
                        <input type="hidden" name="id" value={host.id} />
                        <ConfirmSubmit label="Elimina" confirmLabel="Elimina anche lo storico" />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing !== null && (
        <Modal title={editing === "new" ? "Nuovo host" : "Modifica host"} onClose={closeEditor}>
          <HostForm host={editing === "new" ? null : editing} hosts={hosts} sectors={sectors} onDone={closeEditor} />
        </Modal>
      )}
      {limits && (
        <Modal title="Soglie per tipo" onClose={closeLimits} wide>
          <ThresholdsForm thresholds={thresholds} onDone={closeLimits} />
        </Modal>
      )}
      {importing && (
        <Modal title="Importa host da CSV" onClose={closeImport} wide>
          <ImportForm onDone={closeImport} />
        </Modal>
      )}
    </>
  );
}
