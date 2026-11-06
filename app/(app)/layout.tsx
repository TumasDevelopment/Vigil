import Link from "next/link";
import type { ReactNode } from "react";
import { IconLogout } from "@/components/icons";
import { Credito, Marchio } from "@/components/Marchio";
import { Nav } from "@/components/Nav";
import { OfflinePopup } from "@/components/OfflinePopup";
import { SessionBar } from "@/components/SessionBar";
import { logoutAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { listProfiles } from "@/lib/queries";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const profiles = await listProfiles(user);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__head">
          <Link href="/" className="sidebar__brand" aria-label="Vigil, torna alla panoramica">
            <Marchio />
            <span className="marchio-testo">Vigil</span>
          </Link>
          <Credito />
        </div>
        <Nav isAdmin={user.role === "admin"} profiles={profiles} />
        <div className="sidebar__user">
          <span className="sidebar__avatar" aria-hidden="true">
            {user.username.slice(0, 1)}
          </span>
          <div className="sidebar__who">
            <span className="sidebar__name">{user.username}</span>
            <span className="sidebar__role">{user.role === "admin" ? "Amministratore" : "Visualizzatore"}</span>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="btn btn--small btn--ghost" aria-label="Esci" title="Esci">
              <IconLogout />
            </button>
          </form>
        </div>
      </aside>
      <main className="main">
        <SessionBar kiosk={user.kiosk === true} />
        <div className="content">{children}</div>
      </main>
      <OfflinePopup />
    </div>
  );
}
