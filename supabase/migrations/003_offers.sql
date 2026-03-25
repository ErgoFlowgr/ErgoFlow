-- Offers table (quotes/estimates sent to customers)
create table if not exists offers (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  number text not null,
  customer_id text,
  customer_name text,
  customer_address text,
  status text default 'pending',
  issue_date text,
  expiry_date text,
  notes text,
  subtotal real default 0,
  discount_type text,
  discount_value real default 0,
  discount_amount real default 0,
  tax_rate real default 0,
  tax_amount real default 0,
  total real default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table offers enable row level security;
create policy "owner only" on offers using (auth.uid() = owner_id);

create table if not exists offer_items (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  offer_id text not null references offers(id) on delete cascade,
  description text not null,
  quantity real default 1,
  unit_price real default 0,
  total real default 0,
  sort_order integer default 0
);
alter table offer_items enable row level security;
create policy "owner only" on offer_items using (auth.uid() = owner_id);
