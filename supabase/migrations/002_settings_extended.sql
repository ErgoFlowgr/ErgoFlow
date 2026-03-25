-- Add extended settings columns (added after initial migration)
alter table settings add column if not exists phone2 text;
alter table settings add column if not exists address text;
alter table settings add column if not exists claude_api_key text;
alter table settings add column if not exists allow_web_search boolean default false;
alter table settings add column if not exists brave_search_key text;
alter table settings add column if not exists owner_last_name text;

-- Add synced column to invoice_items if missing
alter table invoice_items add column if not exists synced boolean default false;
