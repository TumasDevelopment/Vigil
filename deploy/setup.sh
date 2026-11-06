#!/usr/bin/env bash
# Installazione di Vigil su un server dell'intranet.
# Si può rilanciare: i passi già fatti vengono saltati.
#
# DOMAIN è il nome o l'indirizzo IP con cui i PC aprono il sito. Il certificato
# si sceglie in uno di questi tre modi:
#
#   Certificato aziendale
#     sudo DOMAIN=vigil.azienda.local CERT=/percorso/fullchain.pem KEY=/percorso/chiave.pem bash deploy/setup.sh
#
#   Certificato autofirmato, generato qui: i PC dovranno fidarsi di lui
#     sudo DOMAIN=vigil.azienda.local SELF_SIGNED=1 bash deploy/setup.sh
#     sudo DOMAIN=10.0.0.20 SELF_SIGNED=1 bash deploy/setup.sh
#
#   Let's Encrypt, se il certificato esiste già in /etc/letsencrypt/live/$DOMAIN
#     sudo DOMAIN=vigil.esempio.it bash deploy/setup.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${APP_USER:-$(stat -c %U "$APP_DIR")}"
DB_NAME=vigil
DB_ROLE=vigil
NGINX_NAME=vigil
TLS_DIR=/etc/vigil/tls
DOMAIN="${DOMAIN:-}"
CERT="${CERT:-}"
KEY="${KEY:-}"
SELF_SIGNED="${SELF_SIGNED:-}"
MIN_NODE=20

die() {
  echo "Errore: $*" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Indica il nome del server e il certificato, in uno di questi modi:

  sudo DOMAIN=vigil.azienda.local CERT=/percorso/fullchain.pem KEY=/percorso/chiave.pem bash deploy/setup.sh
  sudo DOMAIN=vigil.azienda.local SELF_SIGNED=1 bash deploy/setup.sh
  sudo DOMAIN=vigil.esempio.it bash deploy/setup.sh      (certificato Let's Encrypt già emesso)

Al posto del nome si può usare un indirizzo IP. Vedi INSTALLAZIONE.md.
EOF
  exit 1
}

as_app() { sudo -u "$APP_USER" -H bash -lc "cd '$APP_DIR' && $1" </dev/null; }
as_postgres() { (cd /tmp && sudo -u postgres psql -v ON_ERROR_STOP=1 -qAt "$@"); }

is_ip() { [[ "$1" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; }

# Il certificato vale per il nome scelto? Vale anche per i certificati jolly
matches_domain() {
  local flag=-checkhost
  is_ip "$DOMAIN" && flag=-checkip
  openssl x509 -in "$1" -noout "$flag" "$DOMAIN" 2>/dev/null | grep -q 'does match'
}

# nginx legge la chiave da solo all'avvio: una chiave con password lo bloccherebbe
key_matches_cert() {
  local from_key from_cert
  from_key="$(openssl pkey -in "$2" -passin pass: -pubout 2>/dev/null | openssl sha256)" || return 1
  from_cert="$(openssl x509 -in "$1" -noout -pubkey 2>/dev/null | openssl sha256)" || return 1
  [[ "$from_key" == "$from_cert" ]]
}

check_certificate() {
  local cert="$1" key="$2"
  [[ -r "$cert" ]] || die "non riesco a leggere il certificato $cert."
  [[ -r "$key" ]] || die "non riesco a leggere la chiave $key."
  openssl x509 -in "$cert" -noout >/dev/null 2>&1 || die "$cert non è un certificato PEM."
  openssl x509 -in "$cert" -noout -checkend 0 >/dev/null || die "il certificato $cert è scaduto."
  key_matches_cert "$cert" "$key" \
    || die "la chiave $key non corrisponde al certificato, oppure è protetta da password."
  matches_domain "$cert" || die "il certificato $cert non vale per $DOMAIN."
}

generate_certificate() {
  local cert="$1" key="$2" san="DNS:$DOMAIN"
  is_ip "$DOMAIN" && san="IP:$DOMAIN"
  install -d -m 755 "$(dirname "$cert")"
  (
    umask 077
    openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
      -keyout "$key" -out "$cert" -subj "/CN=$DOMAIN" \
      -addext "subjectAltName=$san" -addext "extendedKeyUsage=serverAuth" 2>/dev/null
  )
  chmod 600 "$key"
  chmod 644 "$cert"
}

# Controlli prima di toccare qualsiasi cosa

[[ $EUID -eq 0 ]] || die "va eseguito con sudo."
[[ -n "$DOMAIN" ]] || usage
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] \
  || die "DOMAIN deve essere un nome o un indirizzo IPv4, senza https:// né porta."
[[ "$APP_USER" != "root" ]] \
  || die "la cartella appartiene a root: estraila da utente normale, oppure indica APP_USER=nome."
if [[ -n "$SELF_SIGNED" && ( -n "$CERT" || -n "$KEY" ) ]]; then
  die "scegli tra SELF_SIGNED e CERT con KEY, non entrambi."
fi

for command in nginx psql openssl ping ip; do
  command -v "$command" >/dev/null || die "manca il comando $command: vedi «Preparare il server» in INSTALLAZIONE.md."
done
for command in node npm pm2; do
  as_app "command -v $command" >/dev/null \
    || die "l'utente $APP_USER non trova il comando $command: vedi «Preparare il server» in INSTALLAZIONE.md."
done
node_major="$(as_app "node -p 'process.versions.node.split(\".\")[0]'")"
[[ "$node_major" -ge "$MIN_NODE" ]] || die "serve Node.js $MIN_NODE o successivo, qui c'è il $node_major."
[[ -d /etc/nginx/sites-available ]] \
  || die "manca /etc/nginx/sites-available: su questa distribuzione segui l'installazione manuale."

echo "==> 1/7 Certificato"
if [[ -n "$CERT" || -n "$KEY" ]]; then
  [[ -n "$CERT" && -n "$KEY" ]] || die "CERT e KEY vanno indicati insieme."
  for path in "$CERT" "$KEY"; do
    [[ "$path" =~ ^/[A-Za-z0-9._/+@=-]+$ ]] \
      || die "$path deve essere un percorso assoluto, senza spazi né caratteri speciali."
  done
  cert_path="$CERT"
  key_path="$KEY"
  check_certificate "$cert_path" "$key_path"
  echo "Certificato aziendale controllato."
elif [[ -n "$SELF_SIGNED" ]]; then
  cert_path="$TLS_DIR/$DOMAIN.crt"
  key_path="$TLS_DIR/$DOMAIN.key"
  if [[ -f "$cert_path" && -f "$key_path" ]] \
    && openssl x509 -in "$cert_path" -noout -checkend 2592000 >/dev/null 2>&1 \
    && key_matches_cert "$cert_path" "$key_path" \
    && matches_domain "$cert_path"; then
    echo "Certificato autofirmato già presente."
  else
    generate_certificate "$cert_path" "$key_path"
    echo "Certificato autofirmato creato, valido 825 giorni."
  fi
else
  cert_path="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
  key_path="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
  [[ -f "$cert_path" ]] || usage
  check_certificate "$cert_path" "$key_path"
  echo "Certificato Let's Encrypt controllato."
fi

echo "==> 2/7 Database PostgreSQL"
env_file="$APP_DIR/.env"
if [[ -f "$env_file" ]]; then
  db_password="$(sed -n 's#^DATABASE_URL=postgres://[^:]*:\([^@]*\)@.*#\1#p' "$env_file")"
else
  db_password="$(openssl rand -hex 24)"
fi

if [[ -z "$(as_postgres -c "SELECT 1 FROM pg_roles WHERE rolname = '$DB_ROLE'")" ]]; then
  as_postgres -c "CREATE ROLE $DB_ROLE LOGIN PASSWORD '$db_password'"
else
  as_postgres -c "ALTER ROLE $DB_ROLE LOGIN PASSWORD '$db_password'"
fi
if [[ -z "$(as_postgres -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")" ]]; then
  as_postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_ROLE"
fi

echo "==> 3/7 File .env"
if [[ ! -f "$env_file" ]]; then
  sed "s#^DATABASE_URL=.*#DATABASE_URL=postgres://$DB_ROLE:$db_password@127.0.0.1:5432/$DB_NAME#" \
    "$APP_DIR/.env.example" > "$env_file"
fi
chown "$APP_USER:$(id -gn "$APP_USER")" "$env_file"
chmod 600 "$env_file"

echo "==> 4/7 Tabelle"
as_app "test -d node_modules || npm ci"
as_app "node scripts/migrate.mjs"

echo "==> 5/7 Primo amministratore"
admin_count="$(as_postgres -d "$DB_NAME" -c "SELECT count(*) FROM users WHERE role = 'admin'")"
if [[ "$admin_count" == "0" ]]; then
  while true; do
    read -rp "Nome utente admin: " admin_user
    [[ "$admin_user" =~ ^[a-zA-Z0-9._-]{3,32}$ ]] && break
    echo "Da 3 a 32 caratteri tra lettere, numeri, punto, trattino e underscore."
  done
  while true; do
    read -rsp "Password (almeno 8 caratteri): " admin_password; echo
    read -rsp "Ripeti la password: " admin_confirm; echo
    [[ "$admin_password" == "$admin_confirm" && ${#admin_password} -ge 8 ]] && break
    echo "Le password non coincidono o sono troppo corte. Riprova."
  done
  printf '%s\n' "$admin_password" | sudo -u "$APP_USER" -H bash -lc \
    "cd '$APP_DIR' && node scripts/crea-utente.mjs --username '$admin_user' --role admin"
  unset admin_password admin_confirm
else
  echo "Esiste già un amministratore: passo saltato."
fi

echo "==> 6/7 nginx e firewall"
site="/etc/nginx/sites-available/$NGINX_NAME"
link="/etc/nginx/sites-enabled/$NGINX_NAME"
# Prima i percorsi: contengono il dominio di esempio
sed -e "s#/etc/letsencrypt/live/vigil\.example\.com/fullchain\.pem#$cert_path#" \
    -e "s#/etc/letsencrypt/live/vigil\.example\.com/privkey\.pem#$key_path#" \
    -e "s#vigil\.example\.com#$DOMAIN#g" \
    "$APP_DIR/deploy/nginx-vigil.conf" > "$site"
# Su un server senza IPv6 nginx rifiuterebbe di ascoltare su [::]. I file di /proc risultano vuoti a -s
grep -q . /proc/net/if_inet6 2>/dev/null || sed -i '/listen \[::\]/d' "$site"
# Con un indirizzo IP il browser non dichiara il nome del sito: nginx risponderebbe
# con il certificato del sito predefinito, quindi quello predefinito deve essere Vigil
if is_ip "$DOMAIN"; then
  sed -i -E 's/^( *listen .*443 ssl);/\1 default_server;/' "$site"
fi
ln -sf "$site" "$link"
if ! nginx -t; then
  # Con una configurazione errata nginx non si ricarica: gli altri siti restano come sono
  rm -f "$link"
  is_ip "$DOMAIN" && echo "Se c'è già un altro sito HTTPS predefinito, usa un nome al posto dell'indirizzo IP." >&2
  die "configurazione nginx non valida: sito rimosso, nessun altro sito è stato toccato."
fi
systemctl reload nginx
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow 80/tcp comment 'vigil'
  ufw allow 443/tcp comment 'vigil'
fi

echo "==> 7/7 Avvio con PM2"
as_app "test -f .next/BUILD_ID || npm run build"
as_app "pm2 startOrRestart ecosystem.config.cjs --update-env && pm2 save"
if systemctl is-enabled --quiet "pm2-$APP_USER" 2>/dev/null; then
  echo "Avvio automatico già attivo."
else
  app_home="$(getent passwd "$APP_USER" | cut -d: -f6)"
  pm2_path="$(as_app 'command -v pm2')"
  node_path="$(as_app 'command -v node')"
  PATH="$PATH:$(dirname "$node_path")" "$pm2_path" startup systemd -u "$APP_USER" --hp "$app_home" >/dev/null
  echo "Avvio automatico attivato."
fi

echo
echo "Fatto: https://$DOMAIN"
if [[ -n "$SELF_SIGNED" ]]; then
  echo
  echo "Il certificato è autofirmato: finché un PC non si fida di lui, il browser mostra un avviso."
  echo "Da distribuire ai PC: $cert_path"
  echo "La chiave $key_path non va copiata: resta su questo server."
fi
