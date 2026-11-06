-- ============================================================================
-- 0003_guest_checkout.sql
-- THE ORIGINAL FIT — migrations/0003
--
-- Guests can place orders without an account:
--   anon can INSERT an order row with user_id is null
--   anon can INSERT the order's items (only into that same guest order)
--
-- Signed-in customers keep policies 0002/0001 unchanged (orders_insert_own
-- already covers them). Guest orders surface in the ADMIN console only —
-- they never appear in any customer's "My Orders".
-- ============================================================================

drop policy if exists "orders_insert_guest" on public.orders;
create policy "orders_insert_guest" on public.orders
  for insert to anon
  with check (user_id is null);

drop policy if exists "order_items_insert_guest" on public.order_items;
create policy "order_items_insert_guest" on public.order_items
  for insert to anon
  with check (exists (select 1 from public.orders o where o.id = order_id and o.user_id is null));

-- VERIFY (should list the policies above):
--   select tablename, policyname, cmd, roles
--     from pg_policies
--    where schemaname = 'public'
--      and policyname like '%guest%';
