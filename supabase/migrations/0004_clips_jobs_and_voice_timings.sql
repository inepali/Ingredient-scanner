-- Generated clips become scan_media rows linked back to the photo they came from.
alter table scan_media drop constraint scan_media_kind_check;
alter table scan_media add constraint scan_media_kind_check
  check (kind in ('label', 'product_image', 'product_video', 'clip'));
alter table scan_media add column source_media_id uuid references scan_media on delete set null;
create index on scan_media (source_media_id);

-- Async jobs (fal.ai) keep their request handles and inputs/outputs.
alter table jobs
  add column external_id text,
  add column status_url text,
  add column response_url text,
  add column input jsonb,
  add column output jsonb;

-- Voiceover timings for captions (character level from ElevenLabs, plus word level).
alter table videos
  add column alignment jsonb,
  add column words jsonb;
