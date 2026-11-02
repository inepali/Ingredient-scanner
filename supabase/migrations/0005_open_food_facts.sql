-- Open Food Facts cross-check: keep the ingredient-only score, the outside
-- score and the matched product next to the blended overall_score.
alter table scans
  add column if not exists label_score smallint check (label_score between 0 and 100),
  add column if not exists external_score smallint check (external_score between 0 and 100),
  add column if not exists off_code text,
  add column if not exists off_data jsonb;
