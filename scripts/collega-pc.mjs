// Crea il token per collegare un PC agli avvisi, senza passare dal sito.
// Uso: npm run -s collega-pc -- --username mario --nome "PC ufficio"
// Stampa solo il token: si mostra una volta, nel database resta l'hash.
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import pg from "pg";

try {
  process.loadEnvFile(".env");
} catch {
  // In test le variabili arrivano dall'ambiente
}

const { values } = parseArgs({ options: { username: { type: "string" }, nome: { type: "string" } } });
if (!values.username || !values.nome) {
  console.error('Uso: npm run -s collega-pc -- --username NOME --nome "Nome del PC"');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query("SELECT id FROM users WHERE lower(username) = lower($1)", [values.username]);
  if (!rows[0]) {
    console.error("Utente non trovato.");
    process.exitCode = 1;
  } else {
    const token = randomBytes(32).toString("base64url");
    await client.query("INSERT INTO alert_devices (user_id, name, token_hash) VALUES ($1, $2, $3)", [
      rows[0].id,
      values.nome,
      createHash("sha256").update(token).digest(),
    ]);
    console.log(token);
  }
} finally {
  await client.end();
}
