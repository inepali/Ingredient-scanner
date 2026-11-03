-- Connected Instagram / TikTok accounts (tokens are AES-GCM encrypted by the app)
-- and a record of every post so a video is never published twice by accident.
create table social_accounts (
  platform text primary key check (platform in ('tiktok', 'instagram')),
  external_id text,
  account_name text,
  access_token_enc text not null,
  refresh_token_enc text,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  scope text,
  connected_at timestamptz not null default now(),
  refreshed_at timestamptz
);

create table social_posts (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram')),
  video_path text not null,
  status text not null default 'processing' check (status in ('processing', 'published', 'failed')),
  remote_id text,          -- TikTok publish_id / Instagram container id
  permalink text,
  privacy text,
  caption text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on social_posts (scan_id);

alter table social_accounts enable row level security;
alter table social_posts enable row level security;
