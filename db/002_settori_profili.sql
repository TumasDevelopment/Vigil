-- Tipo di dispositivo. Il settore è la colonna group_name, che esiste già.
ALTER TABLE hosts ADD COLUMN device_type text NOT NULL DEFAULT 'altro'
  CHECK (device_type IN ('server', 'storage', 'switch', 'router', 'wifi', 'pc',
                         'stampante', 'telecamera', 'macchina', 'altro'));

-- Dashboard salvate. owner_id NULL significa condivisa con tutti.
-- Con sectors, device_types e host_ids tutti vuoti il profilo mostra tutti gli host.
CREATE TABLE profiles (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text NOT NULL,
  owner_id     integer REFERENCES users(id) ON DELETE CASCADE,
  sectors      text[] NOT NULL DEFAULT '{}',
  device_types text[] NOT NULL DEFAULT '{}',
  host_ids     integer[] NOT NULL DEFAULT '{}',
  view_mode    text NOT NULL DEFAULT 'cards' CHECK (view_mode IN ('summary', 'cards', 'table', 'wall')),
  group_by     text NOT NULL DEFAULT 'none' CHECK (group_by IN ('none', 'sector', 'type')),
  range_key    text NOT NULL DEFAULT '1h',
  panels       text[] NOT NULL DEFAULT '{tiles,hosts,latency,outages,timeline}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX profiles_name_per_owner ON profiles (coalesce(owner_id, 0), lower(name));
