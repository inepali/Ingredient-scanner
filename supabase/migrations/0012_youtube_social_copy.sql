-- YouTube gets its own title, description and hashtags (it used to reuse Instagram's).
alter table social_copy drop constraint if exists social_copy_platform_check;
alter table social_copy add constraint social_copy_platform_check check (platform in ('tiktok', 'instagram', 'youtube'));
