-- Accesso limitato: un account "restricted" vede solo i settori e i dispositivi scelti al suo interno.
-- Senza scelte non vede nulla: togliere l'ultima scelta non deve aprire l'accesso.
ALTER TABLE users
  ADD COLUMN restricted boolean NOT NULL DEFAULT false,
  ADD COLUMN sectors    text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN host_ids   integer[] NOT NULL DEFAULT '{}';

-- Soglie: quella dell'host vince su quella del tipo. NULL significa nessuna soglia.
ALTER TABLE hosts
  ADD COLUMN ping_enabled    boolean NOT NULL DEFAULT true,
  ADD COLUMN latency_warn_ms real CHECK (latency_warn_ms > 0),
  ADD COLUMN loss_warn_pct   real CHECK (loss_warn_pct >= 0 AND loss_warn_pct <= 100);

CREATE TABLE type_thresholds (
  device_type     text PRIMARY KEY,
  latency_warn_ms real CHECK (latency_warn_ms > 0),
  loss_warn_pct   real CHECK (loss_warn_pct >= 0 AND loss_warn_pct <= 100)
);

-- Medie dell'ultimo minuto: una soglia non deve scattare per un singolo ciclo storto
ALTER TABLE host_state
  ADD COLUMN rtt_1m  real,
  ADD COLUMN loss_1m real;

-- Controlli oltre il ping. tcp usa l'indirizzo dell'host e la porta, http e cert un URL.
CREATE TABLE service_checks (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  host_id     integer NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('tcp', 'http', 'cert')),
  port        integer CHECK (port BETWEEN 1 AND 65535),
  url         text,
  warn_days   integer NOT NULL DEFAULT 30 CHECK (warn_days BETWEEN 1 AND 365),
  status      text NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'ok', 'warn', 'failed')),
  since       timestamptz,
  last_check  timestamptz,
  last_ms     real,
  detail      text NOT NULL DEFAULT '',
  fail_streak integer NOT NULL DEFAULT 0,
  fail_since  timestamptz,
  -- Se l'host era offline il guasto non genera un avviso, e quindi nemmeno il ritorno
  alerted     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'tcp' AND port IS NOT NULL) OR (kind <> 'tcp' AND url IS NOT NULL))
);
CREATE INDEX service_checks_host ON service_checks (host_id);
CREATE UNIQUE INDEX service_checks_name_per_host ON service_checks (host_id, lower(name));

CREATE TABLE service_outages (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  check_id   integer NOT NULL REFERENCES service_checks(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ended_at   timestamptz
);
CREATE INDEX service_outages_started ON service_outages (started_at DESC);
CREATE UNIQUE INDEX service_outages_one_open ON service_outages (check_id) WHERE ended_at IS NULL;

-- Avvisi letti dai PC collegati. host_id NULL riguarda il server: lo vedono solo gli admin.
CREATE TABLE alerts (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts      timestamptz NOT NULL DEFAULT now(),
  host_id integer REFERENCES hosts(id) ON DELETE CASCADE,
  level   text NOT NULL CHECK (level IN ('problem', 'warning', 'resolved')),
  title   text NOT NULL,
  body    text NOT NULL DEFAULT ''
);

-- PC collegati: nel database c'è solo l'hash del token
CREATE TABLE alert_devices (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz
);
CREATE INDEX alert_devices_user ON alert_devices (user_id);

-- Salute del server: un campione al minuto. L'ultimo dettaglio sta in system_state.
CREATE TABLE server_metrics (
  ts       timestamptz PRIMARY KEY,
  cpu_pct  real,
  mem_pct  real,
  swap_pct real,
  disk_pct real,
  load1    real
);
