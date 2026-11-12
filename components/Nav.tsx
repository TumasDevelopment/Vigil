"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { Profile } from "@/lib/types";
import {
  IconAccount,
  IconBookmark,
  IconBox,
  IconCalendar,
  IconChip,
  IconCog,
  IconDevices,
  IconEvents,
  IconGauge,
  IconGrid,
  IconHistory,
  IconKey,
  IconLayers,
  IconMap,
  IconPlug,
  IconRadar,
  IconReport,
  IconServer,
  IconSliders,
  IconTopology,
  IconUsers,
  IconWrench,
} from "./icons";

function NavLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const active =
    href === "/" ? pathname === "/" || pathname.startsWith("/host/") : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`nav__link ${active ? "nav__link--active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      <span className="truncate">{children}</span>
    </Link>
  );
}

export function Nav({ isAdmin, profiles }: { isAdmin: boolean; profiles: Profile[] }) {
  return (
    <nav className="nav" aria-label="Principale">
      <div className="nav__section">Monitoraggio</div>
      <NavLink href="/" icon={<IconGrid />}>
        Panoramica
      </NavLink>
      <NavLink href="/settori" icon={<IconLayers />}>
        Per settore
      </NavLink>
      <NavLink href="/tipi" icon={<IconDevices />}>
        Per tipo
      </NavLink>
      <NavLink href="/servizi" icon={<IconPlug />}>
        Servizi
      </NavLink>
      <NavLink href="/eventi" icon={<IconEvents />}>
        Eventi
      </NavLink>
      <NavLink href="/planimetrie" icon={<IconMap />}>
        Planimetrie
      </NavLink>
      <NavLink href="/topologia" icon={<IconTopology />}>
        Topologia
      </NavLink>
      <NavLink href="/inventario" icon={<IconBox />}>
        Inventario
      </NavLink>
      <div className="nav__section">Viste salvate</div>
      {profiles.map((profile) => (
        <NavLink key={profile.id} href={`/vista/${profile.id}`} icon={<IconBookmark />}>
          {profile.name}
        </NavLink>
      ))}
      <NavLink href="/viste" icon={<IconSliders />}>
        Gestisci viste
      </NavLink>
      {isAdmin && (
        <>
          <div className="nav__section">Amministrazione</div>
          <NavLink href="/admin/host" icon={<IconServer />}>
            Host
          </NavLink>
          <NavLink href="/admin/ricerca" icon={<IconRadar />}>
            Ricerca rete
          </NavLink>
          <NavLink href="/admin/manutenzioni" icon={<IconWrench />}>
            Manutenzioni
          </NavLink>
          <NavLink href="/admin/scadenze" icon={<IconCalendar />}>
            Scadenze
          </NavLink>
          <NavLink href="/admin/report" icon={<IconReport />}>
            Report
          </NavLink>
          <NavLink href="/admin/utenti" icon={<IconUsers />}>
            Utenti
          </NavLink>
          <NavLink href="/admin/registro" icon={<IconHistory />}>
            Registro
          </NavLink>
          <NavLink href="/admin/api" icon={<IconKey />}>
            Chiavi API
          </NavLink>
          <NavLink href="/admin/impostazioni" icon={<IconCog />}>
            Impostazioni
          </NavLink>
          <NavLink href="/admin/server" icon={<IconChip />}>
            Server
          </NavLink>
          <NavLink href="/admin/sistema" icon={<IconGauge />}>
            Sistema
          </NavLink>
        </>
      )}
      <div className="nav__section">Personale</div>
      <NavLink href="/account" icon={<IconAccount />}>
        Il mio account
      </NavLink>
    </nav>
  );
}
