-- When the score ring and rating badges appear in the video: 'start', '10', '15', '25' (seconds) or 'end'.
alter table settings add column if not exists score_reveal text not null default '15';
