"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteProfileAction } from "@/lib/actions";
import { describeScope, inScope, VIEWS } from "@/lib/scope";
import type { Profile } from "@/lib/types";
import { ConfirmSubmit, Modal } from "./forms";
import { IconPlus } from "./icons";
import { newProfileDraft, ProfileForm, type PickableHost, type ProfileDraft } from "./ProfileForm";

export function ProfilesAdmin({
  profiles,
  hosts,
  isAdmin,
}: {
  profiles: Profile[];
  hosts: PickableHost[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ProfileDraft | null>(null);

  function onDone(id?: number) {
    const created = editing?.id === undefined;
    setEditing(null);
    if (created && id) router.push(`/vista/${id}`);
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Viste salvate</h1>
          <p>Ognuna ricorda i suoi host, la visualizzazione e i pannelli scelti.</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setEditing(newProfileDraft(isAdmin))}>
          <IconPlus />
          Nuova vista
        </button>
      </header>

      <section className="panel">
        {profiles.length === 0 ? (
          <div className="empty">Nessuna vista salvata. Creane una per ritrovare subito i dispositivi che guardi più spesso.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Contenuto</th>
                  <th className="num">Host</th>
                  <th>Vista</th>
                  <th>Visibile a</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td>
                      <Link className="cell-main" href={`/vista/${profile.id}`}>
                        {profile.name}
                      </Link>
                    </td>
                    <td className="muted">{describeScope(profile)}</td>
                    <td className="num">{hosts.filter((host) => inScope(host, profile)).length}</td>
                    <td className="muted">{VIEWS.find((view) => view.key === profile.view)?.label}</td>
                    <td className="muted">{profile.shared ? "Condiviso" : "Solo a me"}</td>
                    <td className="actions">
                      {profile.canEdit && (
                        <>
                          <button type="button" className="btn btn--small" onClick={() => setEditing(profile)}>
                            Modifica
                          </button>
                          <form action={deleteProfileAction}>
                            <input type="hidden" name="id" value={profile.id} />
                            <ConfirmSubmit label="Elimina" confirmLabel="Confermi?" />
                          </form>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <Modal title={editing.id ? "Modifica vista" : "Nuova vista"} onClose={() => setEditing(null)} wide>
          <ProfileForm draft={editing} hosts={hosts} isAdmin={isAdmin} onDone={onDone} />
        </Modal>
      )}
    </>
  );
}
