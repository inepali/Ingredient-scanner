-- Server-only access: RLS on with no policies denies the anon/authenticated roles.
-- The service role key (used by the Next.js server) bypasses RLS.
alter table settings enable row level security;
alter table ingredient_reference enable row level security;
alter table scans enable row level security;
alter table scan_media enable row level security;
alter table scan_ingredients enable row level security;
alter table videos enable row level security;
alter table social_copy enable row level security;
alter table jobs enable row level security;

-- Private bucket for label photos, product media and rendered videos.
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;
