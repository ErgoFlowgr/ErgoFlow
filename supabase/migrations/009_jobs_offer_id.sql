-- Add offer_id column to jobs table
alter table jobs add column if not exists offer_id text references offers(id) on delete set null;
