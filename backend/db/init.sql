alter table if exists crm_message_logs rename to message_logs;
alter table if exists crm_integration_settings rename to integration_settings;
alter table if exists crm_agents rename to agents;
alter table if exists crm_campaigns rename to campaigns;
alter table if exists crm_deals rename to deals;
alter table if exists crm_contacts rename to contacts;
alter table if exists crm_contact_group_members rename to contact_group_members;
alter table if exists crm_contact_groups rename to contact_groups;
alter table if exists crm_users rename to users;

create table if not exists users (
  id serial primary key,
  full_name text not null,
  email text not null unique,
  password_hash text not null,
  role_name text not null default 'Administradores',
  created_at timestamptz not null default now()
);

create table if not exists contacts (
  id serial primary key,
  name text not null,
  company text not null,
  channel text not null,
  social_profiles jsonb not null default '[]'::jsonb,
  segment text not null,
  owner_name text not null,
  status text not null,
  score integer not null check (score >= 0 and score <= 100),
  updated_at timestamptz not null default now()
);

alter table contacts
  add column if not exists social_profiles jsonb not null default '[]'::jsonb;

create table if not exists deals (
  id serial primary key,
  title text not null,
  stage text not null,
  amount numeric(12, 2) not null default 0,
  owner_name text not null
);

create table if not exists campaigns (
  id serial primary key,
  name text not null,
  audience text not null,
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  channel text not null
);

create table if not exists agents (
  id serial primary key,
  name text not null,
  area text not null,
  action text not null,
  model text not null
);

create table if not exists integration_settings (
  id serial primary key,
  integration_key text not null unique,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists message_logs (
  id serial primary key,
  contact_id integer references contacts (id) on delete set null,
  channel text not null,
  direction text not null default 'outbound',
  recipient_reference text not null,
  message_text text not null,
  provider_name text not null,
  provider_message_id text,
  status text not null default 'pending',
  media_path text,
  media_kind text,
  media_mime_type text,
  media_filename text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists whatsapp_auto_reply_queue (
  id bigserial primary key,
  contact_id integer references contacts (id) on delete set null,
  sender text not null,
  message_body text not null,
  inbound_message_id bigint,
  provider_message_id text,
  media_descriptor jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  enqueued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text
);

create index if not exists whatsapp_auto_reply_queue_status_id_idx
  on whatsapp_auto_reply_queue (status, id);

create index if not exists whatsapp_auto_reply_queue_enqueued_at_idx
  on whatsapp_auto_reply_queue (enqueued_at, id);

create table if not exists whatsapp_tracking_retry_queue (
  id bigserial primary key,
  contact_id integer references contacts (id) on delete set null,
  sender text not null,
  package_code text not null,
  inbound_message_id bigint,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  tracking_scan_page integer not null default 1,
  next_attempt_at timestamptz not null,
  expires_at timestamptz not null,
  processing_started_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table whatsapp_tracking_retry_queue
  add column if not exists tracking_scan_page integer not null default 1;

create unique index if not exists whatsapp_tracking_retry_queue_active_idx
  on whatsapp_tracking_retry_queue (sender, package_code)
  where status in ('pending', 'processing');

create index if not exists whatsapp_tracking_retry_queue_due_idx
  on whatsapp_tracking_retry_queue (status, next_attempt_at, expires_at);

create table if not exists tariff_rates (
  id serial primary key,
  service_key text not null,
  service_name text not null,
  destination_key text not null,
  destination_name text not null,
  destination_aliases jsonb not null default '[]'::jsonb,
  min_weight_kg numeric(10, 3) not null default 0,
  max_weight_kg numeric(10, 3) not null,
  price numeric(12, 2) not null,
  currency text not null default 'BOB',
  notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_key, destination_key, min_weight_kg, max_weight_kg)
);

create index if not exists tariff_rates_lookup_idx
  on tariff_rates (is_active, service_key, destination_key, min_weight_kg, max_weight_kg);

create table if not exists system_logs (
  id bigserial primary key,
  level text not null default 'info',
  event text not null,
  method text,
  path text,
  status_code integer,
  duration_ms integer,
  user_id integer references users (id) on delete set null,
  ip_address text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists system_logs_created_at_idx on system_logs (created_at desc);
create index if not exists system_logs_level_idx on system_logs (level);
create index if not exists system_logs_path_idx on system_logs (path);
create index if not exists system_logs_created_at_id_idx on system_logs (created_at desc, id desc);
create index if not exists system_logs_level_created_at_idx on system_logs (level, created_at desc);
create index if not exists system_logs_path_created_at_idx on system_logs (path, created_at desc);

alter table message_logs
  add column if not exists media_path text;

alter table message_logs
  add column if not exists media_kind text;

alter table message_logs
  add column if not exists media_mime_type text;

alter table message_logs
  add column if not exists media_filename text;

create table if not exists contact_groups (
  id serial primary key,
  name text not null,
  description text not null default '',
  color text not null default '#0f6b60',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contact_group_members (
  group_id integer not null references contact_groups (id) on delete cascade,
  contact_id integer not null references contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, contact_id)
);

create table if not exists pipeline_states (
  id serial primary key,
  pipeline_key text not null default 'ems',
  state_key text not null,
  title text not null,
  helper text not null default '',
  allowed_states jsonb not null default '[]'::jsonb,
  stage_order integer not null check (stage_order > 0),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline_key, state_key)
);

alter table if exists pipeline_states
  add column if not exists allowed_states jsonb not null default '[]'::jsonb;

create index if not exists pipeline_states_pipeline_order_idx
  on pipeline_states (pipeline_key, stage_order, id);

create table if not exists international_tracking_packages (
  package_code text primary key,
  stage_key text not null,
  latest_event_code integer,
  latest_event_name text not null default '',
  latest_event_at timestamptz,
  search_text text not null default '',
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists international_tracking_packages_stage_idx
  on international_tracking_packages (stage_key, latest_event_at desc nulls last, package_code);

create index if not exists international_tracking_packages_search_idx
  on international_tracking_packages using gin (to_tsvector('simple', search_text));

insert into pipeline_states (pipeline_key, state_key, title, helper, stage_order, is_system)
values
  ('ems', 'received', 'Recibido Origen', 'Ingresados o en recepción inicial', 1, true),
  ('ems', 'transit', 'En Camino', 'En tránsito hacia el destino final', 2, true),
  ('ems', 'regional', 'Recibido Destino', 'Paquetes ya recibidos en la regional', 3, true),
  ('ems', 'courier', 'Cartero', 'Paquetes asignados a reparto', 4, true),
  ('ems', 'delivered', 'Entregado', 'Entregas confirmadas o cerradas', 5, true)
on conflict (pipeline_key, state_key) do nothing;

insert into tariff_rates (
  service_key,
  service_name,
  destination_key,
  destination_name,
  destination_aliases,
  min_weight_kg,
  max_weight_kg,
  price,
  currency,
  notes
)
values
  ('nacional', 'Envio nacional estandar', 'la-paz', 'La Paz', '["lapaz", "lp", "el alto"]'::jsonb, 0, 1, 20, 'BOB', 'Tarifa base editable.'),
  ('nacional', 'Envio nacional estandar', 'la-paz', 'La Paz', '["lapaz", "lp", "el alto"]'::jsonb, 1.001, 5, 35, 'BOB', 'Tarifa base editable.'),
  ('nacional', 'Envio nacional estandar', 'cochabamba', 'Cochabamba', '["cbba", "cocha"]'::jsonb, 0, 1, 25, 'BOB', 'Tarifa base editable.'),
  ('nacional', 'Envio nacional estandar', 'cochabamba', 'Cochabamba', '["cbba", "cocha"]'::jsonb, 1.001, 5, 45, 'BOB', 'Tarifa base editable.'),
  ('nacional', 'Envio nacional estandar', 'santa-cruz', 'Santa Cruz', '["santacruz", "scz", "santa cruz de la sierra"]'::jsonb, 0, 1, 25, 'BOB', 'Tarifa base editable.'),
  ('nacional', 'Envio nacional estandar', 'santa-cruz', 'Santa Cruz', '["santacruz", "scz", "santa cruz de la sierra"]'::jsonb, 1.001, 5, 45, 'BOB', 'Tarifa base editable.'),
  ('ems', 'EMS prioritario', 'nacional', 'Bolivia nacional', '["bolivia", "nacional", "interdepartamental"]'::jsonb, 0, 1, 40, 'BOB', 'Tarifa base editable.'),
  ('ems', 'EMS prioritario', 'nacional', 'Bolivia nacional', '["bolivia", "nacional", "interdepartamental"]'::jsonb, 1.001, 5, 70, 'BOB', 'Tarifa base editable.'),
  ('internacional', 'Envio internacional', 'internacional', 'Internacional', '["exterior", "internacional", "afuera", "otro pais"]'::jsonb, 0, 0.5, 180, 'BOB', 'Tarifa referencial editable.'),
  ('internacional', 'Envio internacional', 'internacional', 'Internacional', '["exterior", "internacional", "afuera", "otro pais"]'::jsonb, 0.501, 2, 320, 'BOB', 'Tarifa referencial editable.')
on conflict (service_key, destination_key, min_weight_kg, max_weight_kg) do nothing;

update pipeline_states as pipeline
set
  title = coalesce(
    nullif(btrim(settings.settings -> 'columns' -> pipeline.state_key ->> 'title'), ''),
    pipeline.title
  ),
  helper = coalesce(
    nullif(btrim(settings.settings -> 'columns' -> pipeline.state_key ->> 'helper'), ''),
    pipeline.helper
  ),
  updated_at = now()
from integration_settings as settings
where settings.integration_key = 'crm_pipeline_config'
  and pipeline.pipeline_key = 'ems'
  and pipeline.state_key in ('received', 'transit', 'regional', 'courier', 'delivered');

insert into pipeline_states (pipeline_key, state_key, title, helper, stage_order, is_system)
select
  'ems',
  coalesce(
    nullif(
      regexp_replace(lower(coalesce(custom_column.value ->> 'id', '')), '[^a-z0-9_-]+', '-', 'g'),
      ''
    ),
    'custom-' || custom_column.ordinality::text
  ) as state_key,
  coalesce(
    nullif(btrim(custom_column.value ->> 'title'), ''),
    'Estado ' || custom_column.ordinality::text
  ) as title,
  coalesce(
    nullif(btrim(custom_column.value ->> 'helper'), ''),
    'Columna personalizada del flujo EMS'
  ) as helper,
  5 + custom_column.ordinality::integer as stage_order,
  false as is_system
from integration_settings as settings
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(settings.settings -> 'customColumns') = 'array'
      then settings.settings -> 'customColumns'
    else '[]'::jsonb
  end
) with ordinality as custom_column(value, ordinality)
where settings.integration_key = 'crm_pipeline_config'
on conflict (pipeline_key, state_key) do update
set
  title = excluded.title,
  helper = excluded.helper,
  stage_order = excluded.stage_order,
  is_system = excluded.is_system,
  updated_at = now();
