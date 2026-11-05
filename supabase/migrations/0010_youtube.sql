-- YouTube joins TikTok and Instagram as a connectable / postable platform.
alter table social_accounts drop constraint if exists social_accounts_platform_check;
alter table social_accounts add constraint social_accounts_platform_check check (platform in ('tiktok', 'instagram', 'youtube'));
alter table social_posts drop constraint if exists social_posts_platform_check;
alter table social_posts add constraint social_posts_platform_check check (platform in ('tiktok', 'instagram', 'youtube'));
