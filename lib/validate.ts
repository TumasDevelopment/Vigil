import { isIP } from "node:net";

const HOSTNAME = /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

/** Accetta solo IP e nomi host: l'indirizzo finisce come argomento del comando ping. */
export function isValidAddress(address: string) {
  return isIP(address) !== 0 || HOSTNAME.test(address);
}

/** Solo http e https. Niente credenziali: l'URL si legge nelle pagine e finisce nel database in chiaro. */
export function isValidCheckUrl(url: string) {
  if (url.length > 300) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export const isValidUsername = (username: string) => /^[a-zA-Z0-9._-]{3,32}$/.test(username);

export const isValidPassword = (password: string) => password.length >= 8 && password.length <= 128;
