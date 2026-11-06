"use client";

import { useEffect, useMemo, useState } from "react";
import { saveProfileAction } from "@/lib/actions";
import { RANGE_KEYS, RANGES, type RangeKey } from "@/lib/ranges";
import {
  ALL_PANELS,
  DEVICE_TYPES,
  GROUPINGS,
  groupHosts,
  inScope,
  NO_SECTOR_LABEL,
  PANELS,
  VIEWS,
  type DeviceType,
  type GroupBy,
  type PanelKey,
  type ViewMode,
} from "@/lib/scope";
import type { Profile } from "@/lib/types";
import { SubmitButton, useFormAction } from "./forms";

export interface PickableHost {
  id: number;
  name: string;
  address: string;
  sector: string;
  type: DeviceType;
}

export type ProfileDraft = Omit<Profile, "id" | "canEdit"> & { id?: number };

export function newProfileDraft(isAdmin: boolean, values: Partial<ProfileDraft> = {}): ProfileDraft {
  return {
    name: "",
    shared: isAdmin,
    sectors: [],
    types: [],
    hostIds: [],
    view: "cards" as ViewMode,
    groupBy: "none" as GroupBy,
    range: "1h" as RangeKey,
    panels: ALL_PANELS,
    ...values,
  };
}

function toggled<T>(list: T[], value: T) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function ProfileForm({
  draft,
  hosts,
  isAdmin,
  onDone,
}: {
  draft: ProfileDraft;
  hosts: PickableHost[];
  isAdmin: boolean;
  onDone: (id?: number) => void;
}) {
  const { state, pending, onSubmit } = useFormAction(saveProfileAction);
  const [sectors, setSectors] = useState(draft.sectors);
  const [types, setTypes] = useState(draft.types);
  const [hostIds, setHostIds] = useState(draft.hostIds);
  const [panels, setPanels] = useState<PanelKey[]>(draft.panels);
  const [needle, setNeedle] = useState("");

  useEffect(() => {
    if (state?.ok) onDone(state.id);
  }, [state, onDone]);

  // Un settore rinominato resta tra le scelte, così si può togliere dalla vista
  const sectorChoices = useMemo(() => {
    const known = groupHosts(hosts, "sector").map((group) => ({ key: group.key, label: group.label }));
    const stale = draft.sectors
      .filter((sector) => !known.some((item) => item.key === sector))
      .map((sector) => ({ key: sector, label: sector || NO_SECTOR_LABEL }));
    return [...known, ...stale];
  }, [hosts, draft.sectors]);

  const included = hosts.filter((host) => inScope(host, { sectors, types, hostIds })).length;
  const search = needle.trim().toLowerCase();
  const pickable = hosts.filter(
    (host) => !search || host.name.toLowerCase().includes(search) || host.address.toLowerCase().includes(search),
  );

  return (
    <form onSubmit={onSubmit} className="form">
      {draft.id && <input type="hidden" name="id" value={draft.id} />}
      {state?.error && (
        <div className="notice notice--error" role="alert">
          {state.error}
        </div>
      )}

      <div className="form__row">
        <label className="field">
          <span>Nome</span>
          <input
            className="input"
            name="name"
            defaultValue={draft.name}
            maxLength={60}
            placeholder="Produzione, Stampanti uffici…"
            required
            autoFocus
          />
        </label>
        {isAdmin && (
          <label className="field">
            <span>Visibile a</span>
            <select className="select" name="shared" defaultValue={String(draft.shared)}>
              <option value="true">Tutti gli utenti</option>
              <option value="false">Solo a me</option>
            </select>
          </label>
        )}
      </div>

      {sectorChoices.length > 0 && (
        <fieldset className="choices">
          <legend>Settori</legend>
          {sectorChoices.map((sector) => (
            <label key={sector.key} className="check">
              <input
                type="checkbox"
                name="sector"
                value={sector.key}
                checked={sectors.includes(sector.key)}
                onChange={() => setSectors(toggled(sectors, sector.key))}
              />
              {sector.label}
            </label>
          ))}
        </fieldset>
      )}

      <fieldset className="choices">
        <legend>Tipi di dispositivo</legend>
        {DEVICE_TYPES.map((type) => (
          <label key={type.key} className="check">
            <input
              type="checkbox"
              name="type"
              value={type.key}
              checked={types.includes(type.key)}
              onChange={() => setTypes(toggled(types, type.key))}
            />
            {type.label}
          </label>
        ))}
      </fieldset>

      {hosts.length > 0 && (
        <fieldset className="choices choices--list">
          <legend>Host aggiunti a mano{hostIds.length > 0 ? ` (${hostIds.length})` : ""}</legend>
          <input
            className="input"
            type="search"
            placeholder="Cerca nome o IP"
            aria-label="Cerca host da aggiungere"
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
          />
          {/* Campi nascosti: gli host scelti restano nel modulo anche se la ricerca li nasconde */}
          {hostIds.map((id) => (
            <input key={id} type="hidden" name="host" value={id} />
          ))}
          <div className="pick-list">
            {pickable.map((host) => (
              <label key={host.id} className="check">
                <input
                  type="checkbox"
                  checked={hostIds.includes(host.id)}
                  onChange={() => setHostIds(toggled(hostIds, host.id))}
                />
                <span className="truncate">{host.name}</span>
                <small>{host.address}</small>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <p className="form__hint">
        <b>{included === 1 ? "1 host incluso." : `${included} host inclusi.`}</b> Settori e tipi si combinano: Produzione
        più Stampanti mostra solo le stampanti di Produzione. Gli host aggiunti a mano ci sono sempre. Senza nessuna
        scelta la vista mostra tutti gli host.
      </p>

      <div className="form__row form__row--three">
        <label className="field">
          <span>Vista</span>
          <select className="select" name="view" defaultValue={draft.view}>
            {VIEWS.map((view) => (
              <option key={view.key} value={view.key}>
                {view.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Raggruppa per</span>
          <select className="select" name="groupBy" defaultValue={draft.groupBy}>
            {GROUPINGS.map((group) => (
              <option key={group.key} value={group.key}>
                {group.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Periodo</span>
          <select className="select" name="range" defaultValue={draft.range}>
            {RANGE_KEYS.map((key) => (
              <option key={key} value={key}>
                {RANGES[key].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="choices">
        <legend>Pannelli da mostrare</legend>
        {PANELS.map((panel) => (
          <label key={panel.key} className="check">
            <input
              type="checkbox"
              name="panel"
              value={panel.key}
              checked={panels.includes(panel.key)}
              onChange={() => setPanels(toggled(panels, panel.key))}
            />
            {panel.label}
          </label>
        ))}
      </fieldset>

      <div className="form__actions">
        <button type="button" className="btn" onClick={() => onDone()}>
          Annulla
        </button>
        <SubmitButton pending={pending}>Salva vista</SubmitButton>
      </div>
    </form>
  );
}
