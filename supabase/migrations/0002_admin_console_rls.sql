-- ============================================================================
-- 0002_admin_console_rls.sql
-- THE ORIGINAL FIT — migrations/0002
--
-- Superuser upgrade for the ADMIN console (pages/admin.html):
--   profiles.is_admin flag + public.is_admin() helper + admin policies:
--     products/categories — full control
--     orders/order_items  — see and progress every order
--     profiles            — inspect members
--     contact/newsletter  — read + delete (replaces the loose "any authenticated"
--                           read from schema.sql v1)
--     storage             — uploads restricted to admins (public READ unchanged)
--
-- Security model: the browser keeps using the anon/publishable key. Admin
-- rights come from the signed-in user's is_admin flag, enforced by RLS here.
--
-- Idempotent: safe to re-run. Run AFTER 0001. Apply once per database.
-- ============================================================================

-- 1) Admin flag on profiles ---------------------------------------------------
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Helper used inside policies (security definer = RLS-proof read of the flag).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- 2) Catalog — full control for admins ---------------------------------------
drop policy if exists "products_admin_all" on public.products;
create policy "products_admin_all" on public.products
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "categories_admin_all" on public.categories;
create policy "categories_admin_all" on public.categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 3) Orders — admins see and progress every order -----------------------------
drop policy if exists "orders_admin_select_all" on public.orders;
create policy "orders_admin_select_all" on public.orders
  for select to authenticated using (public.is_admin());

drop policy if exists "orders_admin_update_all" on public.orders;
create policy "orders_admin_update_all" on public.orders
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "order_items_admin_select_all" on public.order_items;
create policy "order_items_admin_select_all" on public.order_items
  for select to authenticated using (public.is_admin());

-- 4) Profiles — admins can inspect members ------------------------------------
drop policy if exists "profiles_admin_select_all" on public.profiles;
create policy "profiles_admin_select_all" on public.profiles
  for select to authenticated using (public.is_admin());

-- 5) Messages + subscribers — admin-only read, admin delete after handling ----
drop policy if exists "newsletter_admin_read" on public.newsletter_subscribers;
create policy "newsletter_admin_read" on public.newsletter_subscribers
  for select to authenticated using (public.is_admin());

drop policy if exists "newsletter_admin_delete" on public.newsletter_subscribers;
create policy "newsletter_admin_delete" on public.newsletter_subscribers
  for delete to authenticated using (public.is_admin());

drop policy if exists "contact_admin_read" on public.contact_messages;
create policy "contact_admin_read" on public.contact_messages
  for select to authenticated using (public.is_admin());

drop policy if exists "contact_admin_delete" on public.contact_messages;
create policy "contact_admin_delete" on public.contact_messages
  for delete to authenticated using (public.is_admin());

-- 6) Storage — uploads limited to admins in the site buckets ------------------
--    (public read from schema.sql untouched — shoppers can still load images)
drop policy if exists "storage_authenticated_write" on storage.objects;
create policy "storage_authenticated_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('product-images', 'collection-images')
    and public.is_admin()
  );

drop policy if exists "storage_authenticated_update" on storage.objects;
create policy "storage_authenticated_update" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('product-images', 'collection-images')
    and public.is_admin()
  );

drop policy if exists "storage_authenticated_delete" on storage.objects;
create policy "storage_authenticated_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('product-images', 'collection-images')
    and public.is_admin()
  );

-- ============================================================================
-- 7) YOUR ADMIN ACCOUNT — required, do this before the console opens
--
--    a) Who could be admin? (results pane shows emails + current flag)
--
--       select u.email, p.full_name, p.is_admin
--         from auth.users u
--         left join public.profiles p on p.id = u.id
--        order by u.created_at;
--
--    b) Create the admin user (if not already):
--       Supabase Dashboard → Authentication → Users → "Add user" →
--       set email + password and enable "Auto Confirm User".
--
--    c) Promote it — replace with YOUR email, then run the line:
--
--       update public.profiles set is_admin = true
--       where email = 'admin@theoriginalfit.com';
--
--    Revoke later with:  update public.profiles set is_admin = false where email = '...';
-- ============================================================================

-- VERIFY (run after promoting; admins must show is_admin = true):
--   select email, full_name, is_admin from public.profiles order by is_admin desc, email;
