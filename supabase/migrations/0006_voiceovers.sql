-- Keep every generated voiceover ("take") instead of overwriting the last one.
-- videos.audio_path/duration_s/words stay as the copy of the SELECTED take, so
-- rendering is unchanged; videos.voiceover_id says which take that is.
create table voiceovers (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans on delete cascade,
  video_id uuid not null references videos on delete cascade, -- the script version it was made for
  voice_id text,
  voice_name text,
  delivery text,
  audio_path text not null,
  duration_s numeric,
  characters int,
  alignment jsonb,
  words jsonb,
  mock boolean not null default false,
  created_at timestamptz not null default now()
);

create index on voiceovers (scan_id, created_at desc);
create index on voiceovers (video_id);

alter table voiceovers enable row level security; -- server-only access, like every table here

alter table videos add column voiceover_id uuid references voiceovers on delete set null;
create index on videos (voiceover_id);

-- Bring existing audio into the library and mark it as the selected take.
insert into voiceovers (scan_id, video_id, voice_id, audio_path, duration_s, alignment, words, mock, created_at)
select scan_id, id, voice_id, audio_path, duration_s, alignment, words, audio_path like '%.wav', created_at
from videos
where audio_path is not null;

update videos v
set voiceover_id = (
  select o.id from voiceovers o where o.video_id = v.id and o.audio_path = v.audio_path limit 1
)
where v.audio_path is not null;
