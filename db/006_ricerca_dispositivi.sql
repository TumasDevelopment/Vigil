-- Ricerca dei dispositivi: il sito chiede una scansione, il worker la esegue e scrive qui i risultati.
CREATE TABLE discovery_scans (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subnet      text NOT NULL,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  total       integer NOT NULL DEFAULT 0,
  checked     integer NOT NULL DEFAULT 0,
  found       jsonb NOT NULL DEFAULT '[]',
  error       text NOT NULL DEFAULT '',
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- Una ricerca alla volta: lo garantisce il database, anche con due amministratori insieme
CREATE UNIQUE INDEX discovery_one_active ON discovery_scans ((true)) WHERE status IN ('queued', 'running');
