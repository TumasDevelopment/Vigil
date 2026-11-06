-- Dipendenze: se il dispositivo a monte cade, quelli collegati risultano non raggiungibili.
ALTER TABLE hosts
  ADD COLUMN parent_id integer REFERENCES hosts(id) ON DELETE SET NULL,
  ADD CONSTRAINT hosts_parent_not_self CHECK (parent_id <> id);
CREATE INDEX hosts_parent ON hosts (parent_id);

-- alerted false: l'avviso è rimandato per una manutenzione o per un guasto a monte. Il worker
-- ricontrolla a ogni ciclo: se la spiegazione non vale più e l'host è ancora giù, avvisa.
-- Le interruzioni già aperte hanno già avvisato, quindi il valore iniziale è true.
ALTER TABLE outages
  ADD COLUMN alerted       boolean NOT NULL DEFAULT true,
  ADD COLUMN cause_host_id integer REFERENCES hosts(id) ON DELETE SET NULL,
  ADD COLUMN ack_by        text,
  ADD COLUMN ack_at        timestamptz,
  ADD COLUMN note          text NOT NULL DEFAULT '';

ALTER TABLE service_outages
  ADD COLUMN ack_by text,
  ADD COLUMN ack_at timestamptz,
  ADD COLUMN note   text NOT NULL DEFAULT '';

-- Avviso di un dispositivo non raggiungibile: chi vede la causa riceve già quello della causa,
-- quindi lo legge solo un account limitato che non la vede.
ALTER TABLE alerts ADD COLUMN caused_by integer REFERENCES hosts(id) ON DELETE SET NULL;

-- Una finestra riguarda un host oppure un settore. Il settore vuoto è "Senza settore".
CREATE TABLE maintenance_windows (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  host_id    integer REFERENCES hosts(id) ON DELETE CASCADE,
  sector     text,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  reason     text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK ((host_id IS NULL) <> (sector IS NULL))
);
CREATE INDEX maintenance_windows_ends ON maintenance_windows (ends_at);

-- Gli host coperti da ogni finestra, compresi quelli a valle: se si ferma uno switch per lavori,
-- anche chi ci sta dietro cade per lo stesso motivo. UNION si ferma da sola se ci fosse un cerchio.
CREATE VIEW maintenance_hosts AS
WITH RECURSIVE covered AS (
  SELECT h.id AS host_id, w.id AS window_id, w.starts_at, w.ends_at, w.reason
  FROM maintenance_windows w
  JOIN hosts h ON h.id = w.host_id OR (w.host_id IS NULL AND h.group_name = w.sector)
  UNION
  SELECT h.id, c.window_id, c.starts_at, c.ends_at, c.reason
  FROM covered c
  JOIN hosts h ON h.parent_id = c.host_id
)
SELECT host_id, window_id, starts_at, ends_at, reason FROM covered;
