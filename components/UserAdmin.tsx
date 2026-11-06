"use client";

import { useEffect, useMemo, useState } from "react";
import { deleteUserAction, saveUserAction } from "@/lib/actions";
import { fmtFullDate } from "@/lib/format";
import { LocalTime } from "./LocalTime";
import { groupHosts, inAccount, NO_SECTOR_LABEL, type HostGroup } from "@/lib/scope";
import { ConfirmSubmit, Modal, SubmitButton, useFormAction } from "./forms";
import { IconPlus } from "./icons";
import type { PickableHost } from "./ProfileForm";

export interface AdminUser {
  id: number;
  username: string;
  role: "admin" | "viewer";
  last_login: number | null;
  restricted: boolean;
  sectors: string[];
  host_ids: number[];
}

const ROLE_LABEL = { admin: "Amministratore", viewer: "Visualizzatore" };

const devicesText = (count: number) => (count === 1 ? "1 dispositivo" : `${count} dispositivi`);

function accessLabel(user: AdminUser, hosts: PickableHost[]) {
  if (user.role === "admin" || !user.restricted) return "Tutti i dispositivi";
  const count = hosts.filter((host) => inAccount(host, { sectors: user.sectors, hostIds: user.host_ids })).length;
  if (count === 0) return "Nessun dispositivo";
  const sectors = user.sectors.map((sector) => sector || NO_SECTOR_LABEL).join(", ");
  return sectors ? `${devicesText(count)} · ${sectors}` : devicesText(count);
}

/** I dispositivi esistenti divisi per settore: si sceglie il settore intero oppure uno per uno. */
function AccountDevices({ user, hosts }: { user: AdminUser | null; hosts: PickableHost[] }) {
  const [sectors, setSectors] = useState(user?.sectors ?? []);
  const [hostIds, setHostIds] = useState(
    (user?.host_ids ?? []).filter((id) => hosts.some((host) => host.id === id)),
  );
  const [needle, setNeedle] = useState("");

  // Un settore rimasto senza dispositivi resta tra le scelte, così si può togliere dall'account
  const groups = useMemo<HostGroup<PickableHost>[]>(() => {
    const known = groupHosts(hosts, "sector");
    const stale = (user?.sectors ?? [])
      .filter((sector) => !known.some((group) => group.key === sector))
      .map((sector) => ({ key: sector, label: sector || NO_SECTOR_LABEL, hosts: [] }));
    return [...known, ...stale];
  }, [hosts, user]);

  function toggleSector(group: HostGroup<PickableHost>) {
    if (sectors.includes(group.key)) {
      setSectors(sectors.filter((sector) => sector !== group.key));
      return;
    }
    setSectors([...sectors, group.key]);
    // Il settore comprende già i suoi dispositivi: così, togliendolo, non ne resta dentro nessuno
    setHostIds(hostIds.filter((id) => !group.hosts.some((host) => host.id === id)));
  }

  function toggleHost(id: number) {
    setHostIds(hostIds.includes(id) ? hostIds.filter((item) => item !== id) : [...hostIds, id]);
  }

  const included = hosts.filter((host) => inAccount(host, { sectors, hostIds })).length;
  const search = needle.trim().toLowerCase();
  const shown = groups
    .map((group) => ({
      ...group,
      matching: group.hosts.filter(
        (host) => !search || host.name.toLowerCase().includes(search) || host.address.toLowerCase().includes(search),
      ),
    }))
    .filter((group) => !search || group.matching.length > 0);

  return (
    <fieldset className="choices choices--list">
      <legend>Dispositivi dell'account</legend>
      <input
        className="input"
        type="search"
        placeholder="Cerca nome o IP"
        aria-label="Cerca dispositivo"
        value={needle}
        onChange={(event) => setNeedle(event.target.value)}
      />
      {/* Campi nascosti: le scelte restano nel modulo anche se la ricerca le nasconde */}
      {sectors.map((sector) => (
        <input key={`settore-${sector}`} type="hidden" name="sector" value={sector} />
      ))}
      {hostIds.map((id) => (
        <input key={id} type="hidden" name="host" value={id} />
      ))}
      <div className="pick-list pick-list--tall">
        {shown.length === 0 && <span className="muted">{search ? "Nessun risultato." : "Nessun dispositivo."}</span>}
        {shown.map((group) => {
          const whole = sectors.includes(group.key);
          return (
            <div key={group.key} className="pick-group">
              <label className="check pick-group__head">
                <input type="checkbox" checked={whole} onChange={() => toggleSector(group)} />
                {group.label}
                <small>{whole ? "Tutto il settore" : devicesText(group.hosts.length)}</small>
              </label>
              {group.matching.map((host) => (
                <label key={host.id} className="check pick-host">
                  <input
                    type="checkbox"
                    checked={whole || hostIds.includes(host.id)}
                    disabled={whole}
                    onChange={() => toggleHost(host.id)}
                  />
                  <span className="truncate">{host.name}</span>
                  <small>{host.address}</small>
                </label>
              ))}
            </div>
          );
        })}
      </div>
      <p className="form__hint">
        <b>{included === 1 ? "1 dispositivo incluso." : `${included} dispositivi inclusi.`}</b> Con un settore intero
        entrano anche i dispositivi aggiunti dopo. Senza nessuna scelta l'account non vede nulla.
      </p>
    </fieldset>
  );
}

function UserForm({
  user,
  hosts,
  onDone,
}: {
  user: AdminUser | null;
  hosts: PickableHost[];
  onDone: () => void;
}) {
  const { state, pending, onSubmit } = useFormAction(saveUserAction);
  const [role, setRole] = useState(user?.role ?? "viewer");
  const [access, setAccess] = useState(user?.restricted ? "limited" : "all");

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form method="post" onSubmit={onSubmit} className="form">
      {user && <input type="hidden" name="id" value={user.id} />}
      {state?.error && (
        <div className="notice notice--error" role="alert">
          {state.error}
        </div>
      )}
      <label className="field">
        <span>Nome utente</span>
        <input
          className="input"
          name="username"
          defaultValue={user?.username}
          autoComplete="off"
          required
          autoFocus
        />
      </label>
      <label className="field">
        <span>{user ? "Nuova password" : "Password"}</span>
        <input
          className="input"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required={!user}
        />
        <small>
          {user ? "Lascia vuoto per non cambiarla. Se la cambi, l'utente viene scollegato." : "Almeno 8 caratteri."}
        </small>
      </label>
      <label className="field">
        <span>Ruolo</span>
        <select
          className="select"
          name="role"
          value={role}
          onChange={(event) => setRole(event.target.value as AdminUser["role"])}
        >
          <option value="viewer">Visualizzatore: può solo guardare</option>
          <option value="admin">Amministratore: gestisce host e utenti</option>
        </select>
      </label>
      {role === "viewer" && (
        <label className="field">
          <span>Dispositivi visibili</span>
          <select className="select" name="access" value={access} onChange={(event) => setAccess(event.target.value)}>
            <option value="all">Tutti</option>
            <option value="limited">Solo quelli scelti</option>
          </select>
        </label>
      )}
      {role === "viewer" && access === "limited" && <AccountDevices user={user} hosts={hosts} />}
      <div className="form__actions">
        <button type="button" className="btn" onClick={onDone}>
          Annulla
        </button>
        <SubmitButton pending={pending}>Salva</SubmitButton>
      </div>
    </form>
  );
}

export function UserAdmin({
  users,
  hosts,
  currentUserId,
}: {
  users: AdminUser[];
  hosts: PickableHost[];
  currentUserId: number;
}) {
  const [editing, setEditing] = useState<AdminUser | "new" | null>(null);
  const close = () => setEditing(null);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Utenti</h1>
          <p>Ogni account vede i dispositivi scelti al suo interno, per settore o uno per uno.</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setEditing("new")}>
          <IconPlus />
          Nuovo utente
        </button>
      </header>

      <section className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nome utente</th>
                <th>Ruolo</th>
                <th>Dispositivi</th>
                <th>Ultimo accesso</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <span className="cell-main">
                      {user.username}
                      {user.id === currentUserId ? " (tu)" : ""}
                    </span>
                  </td>
                  <td>{ROLE_LABEL[user.role]}</td>
                  <td className="muted">{accessLabel(user, hosts)}</td>
                  <td className="muted">
                    <LocalTime seconds={user.last_login} format={fmtFullDate} />
                  </td>
                  <td className="actions">
                    <button type="button" className="btn btn--small" onClick={() => setEditing(user)}>
                      Modifica
                    </button>
                    {user.id !== currentUserId && (
                      <form action={deleteUserAction}>
                        <input type="hidden" name="id" value={user.id} />
                        <ConfirmSubmit label="Elimina" confirmLabel="Confermi?" />
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing !== null && (
        <Modal title={editing === "new" ? "Nuovo utente" : "Modifica utente"} onClose={close} wide>
          <UserForm user={editing === "new" ? null : editing} hosts={hosts} onDone={close} />
        </Modal>
      )}
    </>
  );
}
