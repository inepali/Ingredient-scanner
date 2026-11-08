-- Your own reusable lines (hooks, references, catchphrases) for the Voice tab.
alter table settings add column if not exists custom_lines jsonb not null default '[]'::jsonb;
