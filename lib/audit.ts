import "server-only";
import { headers } from "next/headers";
import { db } from "./db";

export interface AuditActor {
  id: number | null;
  username: string;
}

/** L'indirizzo del browser: nginx lo mette in X-Real-IP, il resto delle intestazioni non è affidabile. */
export async function clientAddress() {
  try {
    const list = await headers();
    return list.get("x-real-ip") ?? list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * Scrive una riga nel registro delle attività. Non blocca mai l'azione: se il database
 * non risponde, l'errore finisce nel log del sito e l'utente non se ne accorge.
 */
export async function audit(
  actor: AuditActor | null,
  action: string,
  target: string | null = null,
  detail: Record<string, unknown> | null = null,
) {
  try {
    await db().query("INSERT INTO audit_log (user_id, username, action, target, detail, ip) VALUES ($1, $2, $3, $4, $5, $6)", [
      // Le chiavi API non sono utenti: per loro resta solo il nome
      actor && actor.id && actor.id > 0 ? actor.id : null,
      actor?.username ?? null,
      action,
      target?.slice(0, 200) ?? null,
      detail ? JSON.stringify(detail) : null,
      await clientAddress(),
    ]);
  } catch (error) {
    console.error("Registro delle attività non scritto:", error);
  }
}

/** Le descrizioni delle azioni, per la pagina del registro. */
export const AUDIT_LABELS: Record<string, string> = {
  "login.ok": "Accesso",
  "login.failed": "Accesso non riuscito",
  "login.locked": "Accesso bloccato",
  "login.2fa_failed": "Codice di accesso errato",
  "login.recovery": "Accesso con codice di recupero",
  logout: "Uscita",
  "password.change": "Cambio password",
  "2fa.enable": "Due fattori attivati",
  "2fa.disable": "Due fattori disattivati",
  "2fa.reset": "Due fattori azzerati",
  "host.create": "Host aggiunto",
  "host.update": "Host modificato",
  "host.delete": "Host eliminato",
  "host.enable": "Host riattivato",
  "host.disable": "Host sospeso",
  "host.bulk": "Modifica di più host",
  "host.import": "Import di host",
  "host.export": "Export degli host",
  "maintenance.save": "Manutenzione salvata",
  "maintenance.end": "Manutenzione terminata",
  "maintenance.delete": "Manutenzione eliminata",
  "outage.note": "Nota o presa in carico",
  "outage.ack": "Presa in carico",
  "plan.save": "Planimetria salvata",
  "plan.delete": "Planimetria eliminata",
  "plan.positions": "Posizioni sulla planimetria",
  "discovery.start": "Ricerca rete avviata",
  "discovery.cancel": "Ricerca rete annullata",
  "discovery.add": "Host aggiunti dalla ricerca",
  "types.thresholds": "Soglie per tipo",
  "service.save": "Controllo salvato",
  "service.delete": "Controllo eliminato",
  "device.create": "PC collegato agli avvisi",
  "device.delete": "PC scollegato",
  "profile.save": "Vista salvata",
  "profile.delete": "Vista eliminata",
  "user.create": "Utente creato",
  "user.update": "Utente modificato",
  "user.delete": "Utente eliminato",
  "settings.alerts": "Impostazioni degli avvisi",
  "settings.status": "Impostazioni della pagina di stato",
  "domain.save": "Dominio salvato",
  "domain.delete": "Dominio eliminato",
  "domain.recheck": "Dominio da ricontrollare",
  "apikey.create": "Chiave API creata",
  "apikey.delete": "Chiave API revocata",
  "backup.request": "Backup richiesto",
  "report.download": "Report scaricato",
  "report.generate": "Report rigenerato",
  "audit.export": "Export del registro",
};

/** Famiglie di azioni per il filtro del registro: "host" comprende host.create, host.delete… */
export const AUDIT_GROUPS: Record<string, string> = {
  login: "Accessi",
  password: "Password",
  "2fa": "Due fattori",
  user: "Utenti",
  profile: "Profili",
  device: "Dispositivi Windows",
  host: "Host",
  service: "Servizi",
  types: "Tipi di dispositivo",
  plan: "Planimetrie",
  maintenance: "Manutenzioni",
  outage: "Interruzioni",
  discovery: "Ricerca dispositivi",
  domain: "Domini",
  report: "Report",
  backup: "Backup",
  settings: "Impostazioni",
  apikey: "Chiavi API",
  audit: "Registro",
};
