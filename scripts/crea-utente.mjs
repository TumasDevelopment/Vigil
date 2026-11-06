// Crea un utente, o ne reimposta la password se esiste già.
// Uso: npm run utente -- --username mario --role admin
// La password si legge dallo stdin, mai dagli argomenti (sarebbe visibile in `ps`).
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import pg from "pg";
import { hashPassword } from "../lib/password.mjs";

try {
  process.loadEnvFile(".env");
} catch {
  // In test le variabili arrivano dall'ambiente
}

const { values } = parseArgs({
  options: { username: { type: "string" }, role: { type: "string", default: "admin" } },
});

const { username, role } = values;
if (!username || !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
  console.error("Nome utente non valido: 3-32 caratteri tra lettere, numeri, punto, trattino e underscore.");
  process.exit(1);
}
if (role !== "admin" && role !== "viewer") {
  console.error("Il ruolo deve essere admin oppure viewer.");
  process.exit(1);
}

function readPassword() {
  return new Promise((resolve) => {
    const terminal = process.stdin.isTTY;
    const reader = createInterface({ input: process.stdin, output: process.stdout, terminal });
    if (terminal) {
      process.stdout.write("Password: ");
      reader._writeToOutput = () => {};
    }
    reader.once("line", (line) => {
      reader.close();
      if (terminal) process.stdout.write("\n");
      resolve(line);
    });
  });
}

const password = await readPassword();
if (password.length < 8 || password.length > 128) {
  console.error("La password deve avere da 8 a 128 caratteri.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const hash = await hashPassword(password);
  const updated = await client.query(
    "UPDATE users SET password_hash = $2, role = $3 WHERE lower(username) = lower($1) RETURNING id",
    [username, hash, role],
  );
  if (updated.rowCount > 0) {
    await client.query("DELETE FROM sessions WHERE user_id = $1", [updated.rows[0].id]);
    console.log(`Password di ${username} aggiornata (ruolo: ${role}).`);
  } else {
    await client.query("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)", [
      username,
      hash,
      role,
    ]);
    console.log(`Utente ${username} creato (ruolo: ${role}).`);
  }
} finally {
  await client.end();
}
