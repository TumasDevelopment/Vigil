"use client";

import { useEffect, useState } from "react";
import { saveServiceAction } from "@/lib/actions";
import type { ServiceKind, ServiceRow, ServicesData } from "@/lib/types";
import { Modal, SubmitButton, useFormAction } from "./forms";
import { IconPlus } from "./icons";
import { SERVICE_KINDS, ServiceTable } from "./ServiceTable";
import { HealthBanner, RefreshStatus } from "./Toolbar";
import { useLiveData } from "./useLiveData";

export interface ServiceHost {
  id: number;
  name: string;
  address: string;
}

function ServiceForm({
  service,
  hosts,
  onDone,
}: {
  service: ServiceRow | null;
  hosts: ServiceHost[];
  onDone: () => void;
}) {
  const { state, pending, onSubmit } = useFormAction(saveServiceAction);
  const [kind, setKind] = useState<ServiceKind>(service?.kind ?? "tcp");

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form onSubmit={onSubmit} className="form">
      {service && <input type="hidden" name="id" value={service.id} />}
      {state?.error && (
        <div className="notice notice--error" role="alert">
          {state.error}
        </div>
      )}
      <label className="field">
        <span>Host</span>
        <select className="select" name="hostId" defaultValue={service?.hostId} required>
          {hosts.map((host) => (
            <option key={host.id} value={host.id}>
              {host.name} ({host.address})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Nome del servizio</span>
        <input className="input" name="name" defaultValue={service?.name} maxLength={60} placeholder="Gestionale" required />
      </label>
      <label className="field">
        <span>Cosa controllare</span>
        <select
          className="select"
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as ServiceKind)}
        >
          {SERVICE_KINDS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {kind === "tcp" ? (
        <label className="field">
          <span>Porta</span>
          <input
            className="input"
            name="port"
            type="number"
            min={1}
            max={65535}
            defaultValue={service?.port ?? undefined}
            placeholder="443"
            required
          />
          <small>Riesce se la porta accetta la connessione.</small>
        </label>
      ) : (
        <label className="field">
          <span>Indirizzo</span>
          <input
            className="input"
            name="url"
            type="url"
            maxLength={300}
            defaultValue={service?.url ?? undefined}
            placeholder="https://192.168.1.1/"
            required
          />
          <small>
            {kind === "http"
              ? "Riesce con i codici 2xx e 3xx, e con 401 e 403 delle pagine protette da password."
              : "Si legge ogni ora. Per un servizio non web indica la porta, per esempio https://192.168.1.1:636."}
          </small>
        </label>
      )}
      {kind === "cert" && (
        <label className="field">
          <span>Avvisa quanti giorni prima</span>
          <input
            className="input"
            name="warnDays"
            type="number"
            min={1}
            max={365}
            defaultValue={service?.warnDays ?? 30}
            required
          />
        </label>
      )}
      <div className="form__actions">
        <button type="button" className="btn" onClick={onDone}>
          Annulla
        </button>
        <SubmitButton pending={pending}>Salva</SubmitButton>
      </div>
    </form>
  );
}

export function ServicesClient({ isAdmin, hosts }: { isAdmin: boolean; hosts: ServiceHost[] }) {
  const [editing, setEditing] = useState<ServiceRow | "new" | null>(null);
  const [search, setSearch] = useState("");
  // Cambiare l'indirizzo fa rileggere subito i dati, senza aspettare i 10 secondi
  const [version, setVersion] = useState(0);
  const live = useLiveData<ServicesData>(`/api/servizi?v=${version}`);
  const data = live.data;

  const close = () => {
    setEditing(null);
    setVersion((value) => value + 1);
  };

  const needle = search.trim().toLowerCase();
  const services = (data?.services ?? []).filter(
    (service) =>
      !needle ||
      service.name.toLowerCase().includes(needle) ||
      service.hostName.toLowerCase().includes(needle) ||
      service.address.toLowerCase().includes(needle),
  );

  const count = (status: string) => data?.services.filter((service) => service.status === status).length ?? 0;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Servizi</h1>
          <p>Porte, siti web e certificati, controllati oltre al ping</p>
        </div>
        {isAdmin && hosts.length > 0 && (
          <button type="button" className="btn btn--primary" onClick={() => setEditing("new")}>
            <IconPlus />
            Nuovo controllo
          </button>
        )}
      </header>

      <HealthBanner error={live.error} pinger={data?.pinger} />

      <div className="toolbar">
        <input
          className="input"
          type="search"
          placeholder="Cerca servizio, host o IP"
          aria-label="Cerca servizio"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="toolbar__end">
          <RefreshStatus live={live} />
        </div>
      </div>

      {data && (
        <div className="stack">
          {data.services.length > 0 && (
            <div className="tiles">
              <div className="tile">
                <div className="tile__label">Attivi</div>
                <div className="tile__value">
                  {count("ok")}
                  <span className="tile__of">/ {data.services.length}</span>
                </div>
              </div>
              <div className="tile">
                <div className="tile__label">Non rispondono</div>
                <div className="tile__value">{count("failed")}</div>
              </div>
              <div className="tile">
                <div className="tile__label">Da controllare</div>
                <div className="tile__value">{count("warn")}</div>
                <div className="tile__note">Certificati in scadenza</div>
              </div>
            </div>
          )}
          <section className="panel">
            {data.services.length === 0 ? (
              <div className="empty">
                Nessun controllo.{" "}
                {isAdmin ? "Aggiungine uno per sapere se un servizio è fermo anche quando il ping risponde." : ""}
              </div>
            ) : services.length === 0 ? (
              <div className="empty">Nessun servizio corrisponde alla ricerca.</div>
            ) : (
              <ServiceTable services={services} now={data.serverTime} onEdit={isAdmin ? setEditing : undefined} />
            )}
          </section>
        </div>
      )}

      {editing !== null && (
        <Modal title={editing === "new" ? "Nuovo controllo" : "Modifica controllo"} onClose={close}>
          <ServiceForm service={editing === "new" ? null : editing} hosts={hosts} onDone={close} />
        </Modal>
      )}
    </>
  );
}
