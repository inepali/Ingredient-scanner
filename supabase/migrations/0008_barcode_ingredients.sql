-- Ingredient list fetched from Open Food Facts when a barcode is scanned.
alter table scans add column if not exists off_ingredients text;
