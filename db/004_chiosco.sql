-- Una sessione si chiude dopo 1 ora senza attività, a meno che quel browser sia in modalità chiosco.
ALTER TABLE sessions
  ADD COLUMN kiosk       boolean     NOT NULL DEFAULT false,
  ADD COLUMN last_active timestamptz NOT NULL DEFAULT now();
