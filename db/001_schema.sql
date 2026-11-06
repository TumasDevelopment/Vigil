-- Dispositivi da monitorare
CREATE TABLE hosts (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  address    text NOT NULL UNIQUE,
  group_name text NOT NULL DEFAULT '',
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Una riga per host a ogni ciclo di ping
CREATE TABLE ping_results (
  host_id  integer NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  ts       timestamptz NOT NULL,
  online   boolean NOT NULL,
  sent     smallint NOT NULL,
  received smallint NOT NULL,
  rtt_min  real,
  rtt_avg  real,
  rtt_max  real,
  PRIMARY KEY (host_id, ts)
);
-- BRIN: indice minuscolo, ideale per dati inseriti in ordine di tempo (serve alla pulizia)
CREATE INDEX ping_results_ts_brin ON ping_results USING brin (ts);

-- Stato corrente: evita di cercare l'ultima riga in ping_results a ogni aggiornamento
CREATE TABLE host_state (
  host_id     integer PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
  status      text NOT NULL CHECK (status IN ('unknown', 'online', 'offline')),
  since       timestamptz NOT NULL,
  last_check  timestamptz NOT NULL,
  last_rtt    real,
  last_loss   real,
  fail_streak integer NOT NULL DEFAULT 0,
  fail_since  timestamptz
);

-- Interruzioni: ended_at NULL significa "ancora in corso"
CREATE TABLE outages (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  host_id    integer NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ended_at   timestamptz
);
CREATE INDEX outages_started ON outages (started_at DESC);
CREATE INDEX outages_host_started ON outages (host_id, started_at DESC);
CREATE UNIQUE INDEX outages_one_open_per_host ON outages (host_id) WHERE ended_at IS NULL;

CREATE TABLE users (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX users_username_ci ON users (lower(username));

-- Nel database c'è solo l'hash del token: il valore vero sta nel cookie
CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- Battito del worker e data dell'ultima pulizia
CREATE TABLE system_state (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cleanup_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at       timestamptz NOT NULL DEFAULT now(),
  cutoff       timestamptz NOT NULL,
  ping_rows    bigint NOT NULL,
  outage_rows  bigint NOT NULL
);
