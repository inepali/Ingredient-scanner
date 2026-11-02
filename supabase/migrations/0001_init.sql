-- Ingredient Scanner: initial schema (single-user tool, no auth / RLS).
-- Access is server-side only via the service role key.

create extension if not exists "pgcrypto";

create table settings (
  id int primary key default 1 check (id = 1),
  default_voice_id text,
  curated_hashtags text[] not null default '{}',
  music_track text
);
insert into settings (id) values (1);

create table ingredient_reference (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  aliases text[] not null default '{}',
  score int not null check (score between 0 and 100),
  band text not null check (band in ('great', 'good', 'fair', 'poor', 'avoid')),
  notes text,
  goal_modifiers jsonb not null default '{}'
);

create table scans (
  id uuid primary key default gen_random_uuid(),
  product_name text,
  status text not null default 'created',
  overall_score int check (overall_score between 0 and 100),
  created_at timestamptz not null default now()
);

create table scan_media (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans on delete cascade,
  kind text not null check (kind in ('label', 'product_image', 'product_video')),
  storage_path text not null,
  sort_order int not null default 0
);

create table scan_ingredients (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans on delete cascade,
  position int not null,
  raw_name text not null,
  reference_id uuid references ingredient_reference,
  score int check (score between 0 and 100),
  band text check (band in ('great', 'good', 'fair', 'poor', 'avoid')),
  reason text,
  provisional boolean not null default false,
  user_edited boolean not null default false,
  unique (scan_id, position)
);

create table videos (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans on delete cascade,
  script text,
  voice_id text,
  audio_path text,
  video_path text,
  duration_s numeric,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create table social_copy (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram')),
  title text,
  description text,
  hashtags text[] not null default '{}',
  edited boolean not null default false
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans on delete cascade,
  step text not null check (step in ('analyze', 'script', 'voice', 'i2v', 'render', 'copy')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  cost_usd numeric not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create index on scan_ingredients (scan_id, position);
create index on jobs (scan_id, step);

-- Storage bucket for uploads and rendered output (create in the Supabase dashboard):
--   bucket name: media (private; the app uses signed URLs)
