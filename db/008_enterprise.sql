-- Impostazioni modificabili dalla pagina Admin › Impostazioni, una riga per gruppo
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- Critico: avvisa anche nelle ore di silenzio. L'etichetta pubblica mette l'host nella pagina di stato.
ALTER TABLE hosts
  ADD COLUMN critical             boolean NOT NULL DEFAULT false,
  ADD COLUMN public_label         text CHECK (public_label IS NULL OR char_length(public_label) BETWEEN 1 AND 80),
  ADD COLUMN manufacturer         text CHECK (char_length(manufacturer) <= 80),
  ADD COLUMN model                text CHECK (char_length(model) <= 80),
  ADD COLUMN serial               text CHECK (char_length(serial) <= 80),
  ADD COLUMN firmware             text CHECK (char_length(firmware) <= 80),
  ADD COLUMN location             text CHECK (char_length(location) <= 120),
  ADD COLUMN owner                text CHECK (char_length(owner) <= 80),
  ADD COLUMN purchased_on         date,
  ADD COLUMN warranty_until       date,
  ADD COLUMN inventory_note       text CHECK (char_length(inventory_note) <= 500),
  -- La scadenza di garanzia per cui l'avviso è già partito
  ADD COLUMN warranty_alerted_for date;

-- Livello di escalation: 1 riceve subito, 2 e 3 solo se nessuno prende in carico.
-- Il TOTP in attesa ha totp_enabled = false finché il primo codice non viene confermato.
ALTER TABLE users
  ADD COLUMN alert_tier     smallint NOT NULL DEFAULT 1 CHECK (alert_tier BETWEEN 1 AND 3),
  ADD COLUMN totp_secret    text,
  ADD COLUMN totp_enabled   boolean NOT NULL DEFAULT false,
  ADD COLUMN totp_last_step bigint,
  ADD COLUMN recovery_codes bytea[] NOT NULL DEFAULT '{}';

-- Tra password giusta e codice: un token di pochi minuti, nel database solo l'hash
CREATE TABLE login_challenges (
  token_hash bytea PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  attempts   smallint NOT NULL DEFAULT 0
);

-- quiet: creato nelle ore di silenzio, non va ai PC. tier: il livello minimo di chi lo riceve.
-- check_id: il servizio a cui si riferisce, per riproporre alla fine del silenzio ciò che è ancora giù.
ALTER TABLE alerts
  ADD COLUMN quiet    boolean NOT NULL DEFAULT false,
  ADD COLUMN tier     smallint NOT NULL DEFAULT 1 CHECK (tier BETWEEN 1 AND 3),
  ADD COLUMN check_id integer REFERENCES service_checks(id) ON DELETE SET NULL;

ALTER TABLE outages
  ADD COLUMN tier       smallint NOT NULL DEFAULT 1,
  ADD COLUMN tier_since timestamptz;

ALTER TABLE service_outages
  ADD COLUMN tier       smallint NOT NULL DEFAULT 1,
  ADD COLUMN tier_since timestamptz;

-- La scadenza letta dall'ultimo controllo cert, per la pagina Scadenze
ALTER TABLE service_checks ADD COLUMN expires_at timestamptz;

CREATE TABLE domains (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 3 AND 253),
  warn_days   integer NOT NULL DEFAULT 30 CHECK (warn_days BETWEEN 1 AND 365),
  expires_at  timestamptz,
  registrar   text,
  source      text CHECK (source IN ('rdap', 'whois')),
  checked_at  timestamptz,
  error       text,
  alerted_for date,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Un report per mese, generato dal worker il primo del mese successivo
CREATE TABLE reports (
  month      date PRIMARY KEY CHECK (extract(day FROM month) = 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  summary    jsonb NOT NULL,
  pdf        bytea NOT NULL
);

-- Chi ha fatto cosa. username resta anche se l'utente viene eliminato.
CREATE TABLE audit_log (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts       timestamptz NOT NULL DEFAULT now(),
  user_id  integer REFERENCES users(id) ON DELETE SET NULL,
  username text,
  action   text NOT NULL,
  target   text,
  detail   jsonb,
  ip       text
);
CREATE INDEX audit_log_ts ON audit_log (ts DESC);

-- Chiavi per le API: nel database solo l'hash, il prefisso serve a riconoscerle
CREATE TABLE api_keys (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  token_hash bytea NOT NULL UNIQUE,
  prefix     text NOT NULL,
  scope      text NOT NULL CHECK (scope IN ('read', 'write')),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used  timestamptz
);
