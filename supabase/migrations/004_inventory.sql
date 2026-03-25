-- Inventory / price catalog
create table if not exists inventory (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  code text,
  unit text default 'τεμ.',
  price real default 0,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table inventory enable row level security;
create policy "owner only" on inventory using (auth.uid() = owner_id);
