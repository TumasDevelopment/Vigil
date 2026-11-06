-- Le piante dei reparti. L'immagine sta nel database: niente cartelle da salvare a parte nei backup.
CREATE TABLE floor_plans (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  image      bytea NOT NULL,
  mime       text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  -- Cambia con l'immagine: fa parte del suo indirizzo, così il browser non tiene quella vecchia
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX floor_plans_name ON floor_plans (lower(name));

-- La posizione è una frazione dell'immagine, da 0 a 1: non dipende dalla grandezza dello schermo
CREATE TABLE floor_plan_hosts (
  plan_id integer NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  host_id integer NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  x       real NOT NULL CHECK (x >= 0 AND x <= 1),
  y       real NOT NULL CHECK (y >= 0 AND y <= 1),
  PRIMARY KEY (plan_id, host_id)
);
CREATE INDEX floor_plan_hosts_host ON floor_plan_hosts (host_id);
