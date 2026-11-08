# Vigil: installazione

Vigil è una dashboard che controlla i dispositivi di rete con un ping ogni 10 secondi e ne mostra stato, storico e interruzioni. È fatta di tre parti:

- il **sito** (Next.js), che gira sulla porta locale 3110 dietro nginx;
- il **worker**, un processo separato che fa ping, controlli sui servizi, ricerca sulla rete e pulizia dei dati;
- il **database** PostgreSQL.

Il codice è solo lo scheletro: niente host, niente account, niente dati. Il primo amministratore si crea durante l'installazione.

> **Dove installarla.** Vigil è pensata come servizio interno: va installata su un server dentro l'intranet, oppure collegato in VPN, perché vede solo ciò che riesce a raggiungere. Non serve un dominio pubblico. Su un VPS pubblico funziona solo con indirizzi pubblici, e la ricerca dei dispositivi non ha reti da esplorare.

## Contenuto del progetto

| Percorso | Cosa contiene |
|---|---|
| `app/`, `components/`, `lib/` | Il sito: pagine, API, interfaccia, query |
| `worker/` | Ping, controlli, ricerca sulla rete, salute del server |
| `db/` | Le tabelle, in migrazioni numerate |
| `scripts/` | `migrate.mjs`, `crea-utente.mjs`, `collega-pc.mjs` |
| `deploy/setup.sh` | Installazione automatica |
| `deploy/nginx-vigil.conf` | Configurazione di nginx |
| `deploy/avvisi-windows.ps1` | Agente delle notifiche per i PC Windows |
| `ecosystem.config.cjs` | I due processi PM2 |
| `.env.example` | Modello delle impostazioni |
| `tests/` | Test automatici |

## Requisiti

| Componente | Versione | Note |
|---|---|---|
| Linux | Ubuntu o Debian | Provata solo su Ubuntu 26.04. `setup.sh` richiede `/etc/nginx/sites-available`; sulle altre distribuzioni segui l'installazione manuale |
| Node.js | 24 | Provata sulla 24. Le dipendenze chiedono almeno la 20.12, che però non è stata provata. `npm test` richiede 22.18 o successiva |
| PostgreSQL | 14 o successiva | Provata sulla 18. Sotto la 14 manca `date_bin` |
| nginx | Recente | Provata sulla 1.28 |
| PM2 | Recente | Provata sulla 6. Va installato globalmente: la pagina Server lo richiama con `pm2 jlist` |
| `ping`, `ip` | Pacchetti `iputils-ping` e `iproute2` | `ping` deve funzionare da utente normale |
| `ieee-data` | Facoltativo | Serve a mostrare il produttore nella ricerca dei dispositivi |

Serve anche **HTTPS, pure in intranet**: in produzione il cookie di sessione viaggia solo su HTTPS, quindi su `http://` il login non funziona. Fa eccezione `localhost`, utile per una prova. Basta un nome interno o un indirizzo IP: vedi [Certificato](#certificato).

La compilazione non scarica nulla da internet: i font sono nel progetto. Serve solo raggiungere il registro npm per `npm ci`.

Come riferimento: su 2 core e 4 GB, con 50 host e 7 giorni di dati, il sito usa circa 250 MB e il worker circa 135 MB nei momenti di picco.

## Preparare il server

Su Ubuntu o Debian:

```bash
sudo apt update
sudo apt install -y postgresql nginx iputils-ping iproute2 ieee-data openssl

curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Controlla che `ping` funzioni senza sudo:

```bash
ping -c 1 127.0.0.1
```

Se risponde "Operation not permitted":

```bash
sudo setcap cap_net_raw+ep /usr/bin/ping
```

### Certificato

Scegli **come i PC apriranno il sito**, con un nome interno come `vigil.azienda.local` oppure con un indirizzo IP, e prepara il certificato per quel nome. Le strade sono tre.

| Strada | Quando | Cosa fare |
|---|---|---|
| Certificato aziendale | C'è una CA interna, per esempio in Active Directory | Fatti emettere un certificato per il nome scelto. I PC del dominio si fidano già. È la strada consigliata |
| Autofirmato | Non c'è una CA interna | Lo genera `setup.sh` con `SELF_SIGNED=1`, valido 825 giorni, in `/etc/vigil/tls/`. Va distribuito ai PC |
| Let's Encrypt | Il server ha un dominio pubblico | Crea il certificato con `certbot`, poi lancia `setup.sh` con il solo `DOMAIN` |

Con un indirizzo IP i browser non dichiarano il nome del sito, quindi lo script rende Vigil il sito HTTPS predefinito di nginx. Se sullo stesso server c'è già un altro sito HTTPS predefinito, usa un nome.

Il certificato aziendale va in formato PEM, con la catena completa nello stesso file, e la chiave senza password. Lo script controlla che sia leggibile, valido, adatto al nome scelto e abbinato alla chiave: se qualcosa non torna si ferma prima di toccare il server.

Per far fidare i PC di un certificato autofirmato, copia su ognuno il file `.crt`, **mai** la chiave. Su Windows, in PowerShell da amministratore:

```powershell
Import-Certificate -FilePath .\vigil.azienda.local.crt -CertStoreLocation Cert:\LocalMachine\Root
```

Su molti PC conviene farlo con un criterio di gruppo. Anche l'agente delle notifiche per Windows ha bisogno di questo passo.

## Installazione rapida

Scarica il codice **da utente normale**, non da root: i processi gireranno con l'utente proprietario della cartella. Con git:

```bash
git clone https://github.com/TumasDevelopment/Vigil.git ~/vigil
```

Oppure da un archivio:

```bash
mkdir -p ~/vigil
tar -xzf vigil.tar.gz -C ~/vigil --strip-components=1
```

Poi lancia lo script con la strada scelta per il certificato:

```bash
cd ~/vigil

# Certificato aziendale
sudo DOMAIN=vigil.azienda.local CERT=/etc/ssl/vigil/fullchain.pem KEY=/etc/ssl/vigil/chiave.pem bash deploy/setup.sh

# Autofirmato, con un nome o con un indirizzo IP
sudo DOMAIN=vigil.azienda.local SELF_SIGNED=1 bash deploy/setup.sh
sudo DOMAIN=10.0.0.20 SELF_SIGNED=1 bash deploy/setup.sh

# Let's Encrypt, già emesso
sudo DOMAIN=vigil.esempio.it bash deploy/setup.sh
```

Lo script controlla i requisiti e il certificato, crea ruolo e database con una password casuale, scrive `.env` con permessi 600, installa le dipendenze, crea le tabelle, chiede nome e password del primo amministratore, configura nginx, apre le porte 80 e 443 se `ufw` è attivo, compila il sito, avvia i processi e li fa ripartire a ogni riavvio del server. Si può rilanciare: i passi già fatti vengono saltati.

Apri `https://vigil.azienda.local` e accedi. Il nome deve risolversi dai PC: aggiungilo al DNS interno, oppure usa l'indirizzo IP.

## Installazione manuale

Da usare su altre distribuzioni, con un certificato proprio o per capire cosa fa lo script.

**1. Database.** Sostituisci `PASSWORD` con una password lunga, solo lettere e numeri:

```bash
sudo -u postgres psql -c "CREATE ROLE vigil LOGIN PASSWORD 'PASSWORD'"
sudo -u postgres psql -c "CREATE DATABASE vigil OWNER vigil"
```

**2. Impostazioni.** Nella cartella del progetto:

```bash
cp .env.example .env
chmod 600 .env
```

Scrivi in `.env` la password in `DATABASE_URL`.

**3. Dipendenze, tabelle, primo amministratore.**

```bash
npm ci
npm run migrate
npm run utente -- --username mario --role admin
```

L'ultimo comando chiede la password, almeno 8 caratteri. Rilanciato su un utente esistente, gli reimposta la password.

**4. Compilazione e avvio.**

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

**5. nginx.** Copia `deploy/nginx-vigil.conf` tra i siti di nginx, sostituisci `vigil.example.com` con il nome del server e indica i percorsi del certificato:

```bash
sudo sed -e "s#/etc/letsencrypt/live/vigil\.example\.com/fullchain\.pem#/etc/ssl/vigil/fullchain.pem#" \
  -e "s#/etc/letsencrypt/live/vigil\.example\.com/privkey\.pem#/etc/ssl/vigil/chiave.pem#" \
  -e "s#vigil\.example\.com#vigil.azienda.local#g" deploy/nginx-vigil.conf \
  | sudo tee /etc/nginx/sites-available/vigil > /dev/null
sudo ln -s /etc/nginx/sites-available/vigil /etc/nginx/sites-enabled/vigil
sudo nginx -t && sudo systemctl reload nginx
```

Su un server senza IPv6 togli le due righe `listen [::]`. Le righe `proxy_set_header` vanno tenute tutte. `Host` e `X-Forwarded-Host` devono coincidere con l'indirizzo nel browser, altrimenti Next.js rifiuta i moduli. `X-Real-IP` serve al limite dei tentativi di accesso.

**6. Firewall.** Lascia aperte solo le porte 80, 443 e quella di SSH. La 3110 e la 5432 ascoltano solo su `127.0.0.1` e non vanno aperte.

## Impostazioni in `.env`

| Variabile | Predefinito | Significato |
|---|---|---|
| `DATABASE_URL` | Nessuno | Connessione a PostgreSQL |
| `PING_INTERVAL_SECONDS` | 10 | Ogni quanti secondi si pingano gli host |
| `OFFLINE_AFTER_FAILURES` | 2 | Cicli falliti di fila prima di dichiarare offline un host |
| `CHECK_INTERVAL_SECONDS` | 30 | Ogni quanti secondi si controllano porte, siti e certificati |
| `SERVER_SAMPLE_SECONDS` | 60 | Ogni quanti secondi si registra la salute del server |
| `RETENTION_CYCLE_DAYS` | 14 | Ogni quanti giorni parte la pulizia |
| `RETENTION_KEEP_DAYS` | 7 | Quanti giorni di dati tiene la pulizia |
| `SOURCE_URL` | Repository di Vigil | Indirizzo del link «Codice sorgente» nell'interfaccia |

Dopo una modifica: `pm2 restart ecosystem.config.cjs --update-env`.

## Attivare le funzioni

Tutto si configura dal sito, con un account amministratore. Sono nomi di voci del menu.

| Funzione | Dove | Da sapere |
|---|---|---|
| Aggiungere dispositivi | **Host**, poi **Nuovo host** o **Importa elenco** | Ogni host ha indirizzo, settore e tipo. I settori nascono quando li scrivi |
| Trovarli in automatico | **Ricerca rete** | Scrivi la sottorete con la maschera, per esempio `192.168.1.0/24`. Qualsiasi rete privata, dalla /8 alla /32, con il prefisso (`/24`) o con la maschera (`255.255.255.0`): una /16 richiede circa mezz'ora, una /8 alcuni giorni. Controlla le porte 22, 80, 443, 445, 554, 631, 3389 e 9100: un sistema anti-intrusione può segnalarlo |
| Soglie di latenza e perdita | **Host**, poi **Soglie per tipo** | Oltre soglia il dispositivo diventa Instabile |
| Controlli su porte, siti e certificati | **Servizi**, poi **Nuovo controllo** | Per un host che non risponde al ping: spegni il ping nell'host e aggiungi un controllo su una porta |
| Dipendenze | **Host**, campo **Collegato a** | Se cade lo switch, gli host collegati risultano non raggiungibili e arriva un solo avviso |
| Manutenzioni | **Manutenzioni**, poi **Nuova manutenzione** | Nessun avviso nella finestra e nessun peso sulla disponibilità. Copre anche i dispositivi collegati |
| Presa in carico | **Eventi** | Un amministratore segnala chi segue il guasto e aggiunge una nota |
| Planimetrie | **Planimetrie**, poi **Nuova planimetria** | PNG, JPEG o WebP: PDF e CAD vanno esportati prima. Si clicca sulla pianta per posizionare i dispositivi |
| Account | **Utenti**, poi **Nuovo utente** | Amministratore o visualizzatore. Un account può vedere tutto oppure solo settori e dispositivi scelti |
| Viste salvate | **Gestisci viste** | Selezioni di dispositivi con un nome, nel menu laterale |
| Notifiche su Windows | **Il mio account**, poi **Collega un PC** | Mostra un comando da incollare in PowerShell, senza permessi di amministratore. Il PC deve fidarsi del certificato del sito |
| Modalità chiosco | Pulsante **Modalità chiosco** in alto | Schermo intero. Senza chiosco la sessione si chiude dopo 1 ora di inattività |
| Stato del server | **Server** e **Sistema** | Risorse, processi PM2, siti nginx, worker, database e pulizia |

Un dispositivo offline da più di 2 minuti apre un avviso al centro della pagina per chi è collegato.

## Come si comporta il sito

### Manutenzioni e dipendenze

- Una manutenzione su un host copre anche i dispositivi collegati a lui.
- Durante una manutenzione gli avvisi di certificato in scadenza arrivano comunque.
- Se l'avviso di problema era già partito prima della finestra, arriva anche quello di ritorno online.
- Un dispositivo ancora giù a fine finestra genera un solo avviso.
- Una manutenzione non può iniziare nel passato: un inizio già trascorso diventa "adesso", così non cancella dalla disponibilità guasti già avvenuti.
- I dispositivi non raggiungibili pesano sulla disponibilità: solo la manutenzione ne è esclusa.
- Un account limitato riceve i propri avvisi quando il dispositivo a monte è fuori dal suo account.
- Le dipendenze non si creano da sole: vanno impostate nel campo **Collegato a** di ogni host.

### Presa in carico

- Solo gli amministratori prendono in carico e scrivono note. I visualizzatori leggono.
- Le interruzioni con una nota sopravvivono alla pulizia automatica. Si trovano in **Eventi** con il filtro "Con nota, tutto lo storico".

### Ricerca dei dispositivi

- Un dispositivo risulta trovato se risponde al ping, se ha aperta una delle porte controllate o se compare nella tabella ARP del server.
- Parte una ricerca alla volta e si può annullare. Restano le ultime 5. Se il worker si riavvia, la ricerca in corso risulta interrotta.
- Niente è preselezionato e i dispositivi già presenti non si possono scegliere.
- Il tipo è una stima: si può correggere prima di aggiungere.
- Senza ping ma con una porta aperta, l'host si aggiunge con il ping spento e un controllo su quella porta.
- Visto solo nella tabella ARP, l'host si aggiunge con il ping spento, senza controlli e con stato "Nessun dato".

### Planimetrie

- L'immagine sta nel database, ridotta dal browser sotto 950 KB.
- Gli account limitati vedono solo le piante con i loro host, e sulla pianta solo i loro segnaposto.
- Solo gli amministratori modificano: clic per posizionare, trascinamento o frecce per spostare, poi **Salva posizioni**.
- Sostituendo l'immagine le posizioni restano.
- Lo stato si aggiorna ogni 10 secondi. Sul telefono la pianta scorre di lato.

## Cambiare nome e colori

| Cosa | Dove |
|---|---|
| Colori dell'interfaccia | `app/globals.css`, blocco `:root` in cima al file |
| Colori dei grafici | `lib/palette.ts` |
| Nome nel menu | `app/(app)/layout.tsx` |
| Firma sotto il nome | `components/Marchio.tsx` |
| Font | `app/fonts/`, caricati da `app/layout.tsx` |
| Nome nella pagina di accesso | `app/login/page.tsx` |
| Titolo della scheda del browser | `app/layout.tsx` |
| Icona del sito | `app/icon.svg` |

Lo stato di un dispositivo si legge sempre anche dal testo, non solo dal colore: mantieni questa regola se cambi i colori. Dopo le modifiche:

```bash
npm run build
pm2 restart vigil
```

## Sicurezza

Già attivi: password con hash, sessioni salvate come hash, cookie `httpOnly` e `secure`, limite ai tentativi di accesso, Content-Security-Policy con nonce, query parametrizzate, controllo dei permessi su ogni pagina e azione.

Da fare sul server:

- **Firewall:** solo 80, 443 e SSH.
- **SSH:** accesso con chiave, `PasswordAuthentication no`, e `fail2ban`.
- **Backup:** vedi sotto, l'installazione non ne programma nessuno.
- **`.env`:** deve restare con permessi 600 e fuori da qualsiasi repository.
- **Nome dedicato:** i cookie non distinguono le porte. Se altri siti girano sullo stesso nome host, ricevono anche il cookie di Vigil: dalle un nome tutto suo.
- **Chiave del certificato:** resta sul server, leggibile solo da root. Ai PC si distribuisce il certificato, mai la chiave.
- **Aggiornamenti:** tieni attivi quelli automatici del sistema e controlla ogni tanto `npm audit`.

Due scelte da conoscere:

- La Content-Security-Policy ammette gli stili in linea, perché grafici e planimetria li usano. Gli script in linea restano bloccati.
- HSTS non è attivo, perché varrebbe per tutto il dominio. Se tutto il dominio è in HTTPS, si può aggiungere in nginx.

Gli amministratori possono far controllare al server indirizzi interni: è la funzione stessa dei servizi, quindi dai quel ruolo solo a chi ne ha bisogno.

## Backup e ripristino

Backup:

```bash
pg_dump -h 127.0.0.1 -U vigil -Fc vigil > vigil-$(date +%F).dump
```

La password è quella in `.env`. Per programmarlo senza prompt, salvala in `~/.pgpass` con permessi 600 e aggiungi il comando a `crontab -e`. Tieni una copia anche fuori dal server. Salva pure `.env`.

Ripristino, a processi fermi:

```bash
pm2 stop ecosystem.config.cjs
pg_restore -h 127.0.0.1 -U vigil -d vigil --clean --if-exists vigil-AAAA-MM-GG.dump
pm2 start ecosystem.config.cjs
```

## Aggiornare

Con una nuova versione del codice: fai prima il backup, aggiorna i file con `git pull` o sovrascrivili tenendo `.env`, poi:

```bash
npm ci
npm run migrate
npm run build
pm2 restart ecosystem.config.cjs --update-env
```

Le migrazioni già applicate vengono saltate.

## Problemi frequenti

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| Il login torna alla pagina di accesso senza errori | Sito aperto su `http://` | Usa HTTPS: il cookie è `secure` |
| I moduli danno errore, ma le pagine si aprono | `Host` o `X-Forwarded-Host` non coincidono con l'indirizzo del browser | Ripristina le righe `proxy_set_header` di nginx. Se davanti c'è un altro proxy, deve passare il nome originale |
| 502 da nginx | Il sito non è in esecuzione | `pm2 status` e `pm2 logs vigil --lines 50` |
| Tutti gli host offline | Worker fermo, o `ping` senza permessi | `pm2 logs vigil-pinger --lines 50`, poi prova `ping -c 1 127.0.0.1` |
| `setup.sh` si ferma sul certificato | Certificato mancante, scaduto, per un altro nome, o chiave sbagliata o con password | Leggi l'errore, correggi e rilancia lo script. Per togliere la password: `openssl pkey -in chiave.pem -out senza-password.pem` |
| Il browser avvisa che il sito non è sicuro | Il PC non si fida del certificato autofirmato | Distribuisci il file `.crt`: vedi [Certificato](#certificato) |
| Un host risulta sempre offline ma funziona | Blocca il ping | Spegni il ping nell'host e aggiungi un controllo su una porta |
| La ricerca non trova nulla | Il server non è in quella rete | Usa una sottorete raggiungibile dal server: il modulo propone la sua |
| La ricerca non mostra i produttori | `ieee-data` assente, o dispositivi dietro un router | Installa `ieee-data`. Il MAC si vede solo sulla stessa rete del server |
| La pagina Server non mostra i processi | `pm2` non è nel PATH del worker | Installa PM2 globalmente e riavvia il worker |
| La pagina Server non mostra i siti | File di nginx non leggibili dall'utente | Dai il permesso di lettura su `/etc/nginx/sites-enabled` |
| Il comando di **Collega un PC** dà errore TLS | Il PC non si fida del certificato | Con Let's Encrypt non succede. Con un certificato interno installa sul PC la sua CA, o il certificato autofirmato |
| `npm run migrate` dà errore di connessione | `DATABASE_URL` errato | Controlla password e porta in `.env`, e che PostgreSQL sia attivo: `systemctl status postgresql` |
| Errore su `date_bin` | PostgreSQL più vecchio della 14 | Aggiorna PostgreSQL |

Per guardare nei log:

```bash
pm2 status
pm2 logs vigil --lines 100
pm2 logs vigil-pinger --lines 100
```
