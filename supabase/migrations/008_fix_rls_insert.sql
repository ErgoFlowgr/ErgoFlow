-- Fix RLS policies to allow INSERT (add WITH CHECK clause)
drop policy if exists "owner only" on offers;
create policy "owner only" on offers
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "owner only" on offer_items;
create policy "owner only" on offer_items
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "owner only" on inventory;
create policy "owner only" on inventory
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
