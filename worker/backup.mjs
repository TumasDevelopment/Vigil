// Backup del database con pg_dump in formato custom (-Fc): compresso, si ripristina con pg_restore.
// La password passa nelle variabili d'ambiente PG*, mai negli argomenti (che `ps` mostra a tutti).
import { execFile } from "node:child_process";
import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const FILE_PATTERN = /^vigil-\d{8}-\d{6}\.dump$/;
const DUMP_TIMEOUT_MS = 15 * 60 * 1000;

/** Le variabili PG* ricavate da DATABASE_URL (postgres://utente:password@host:porta/db). */
export function pgEnvFromUrl(url) {
  const parsed = new URL(url);
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error("DATABASE_URL non è un indirizzo PostgreSQL");
  const env = {
    PGHOST: decodeURIComponent(parsed.hostname || "localhost"),
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  };
  const host = parsed.searchParams.get("host");
  if (host) env.PGHOST = host;
  const sslmode = parsed.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  for (const [key, value] of Object.entries(env)) if (value === "") delete env[key];
  return env;
}

/** vigil-AAAAMMGG-HHMMSS.dump, in UTC: i nomi si ordinano come le date. */
export function backupFileName(date) {
  const iso = date.toISOString();
  return `vigil-${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}.dump`;
}

/** I backup da cancellare per tenerne solo `keep`, i più recenti. Gli altri file non si toccano. */
export function pickOld(names, keep) {
  return names
    .filter((name) => FILE_PATTERN.test(name))
    .sort()
    .reverse()
    .slice(Math.max(1, keep));
}

export const backupDir = (configured) => path.resolve(configured || path.join(homedir(), "vigil-backup"));

/** La versione di pg_dump, per esempio "18.1"; null se non è installato. */
export async function pgDumpVersion() {
  try {
    const { stdout } = await run("pg_dump", ["--version"], { timeout: 10_000 });
    return /(\d+(?:\.\d+)*)/.exec(stdout)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function listBackups(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const name of names.filter((entry) => FILE_PATTERN.test(entry)).sort().reverse()) {
    const info = await stat(path.join(dir, name));
    files.push({ name, bytes: info.size, at: info.mtime.toISOString() });
  }
  return files;
}

export async function runBackup({ databaseUrl, dir, keep, now = new Date() }) {
  const started = Date.now();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const name = backupFileName(now);
  const final = path.join(dir, name);
  const partial = `${final}.partial`;
  const env = { ...process.env, ...pgEnvFromUrl(databaseUrl) };
  try {
    await run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--file=${partial}`], {
      env,
      timeout: DUMP_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    await chmod(partial, 0o600);
    // Se pg_restore non riesce a leggerne l'indice, il file non è un backup valido
    await run("pg_restore", ["--list", partial], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    await rename(partial, final);
  } catch (error) {
    await rm(partial, { force: true });
    const detail = String(error.stderr || error.message || error).trim().split("\n").slice(-2).join(" ");
    throw new Error(detail.slice(0, 300));
  }
  const removed = pickOld(await readdir(dir), keep);
  for (const old of removed) await rm(path.join(dir, old), { force: true });
  const { size } = await stat(final);
  return { file: name, bytes: size, durationMs: Date.now() - started, removed: removed.length };
}
