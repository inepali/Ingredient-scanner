-- A scan's report page can be shared publicly (off by default).
alter table scans add column if not exists is_public boolean not null default false;
