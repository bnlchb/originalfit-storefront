-- ============================================================================
-- THE ORIGINAL FIT — Admin console upgrade
-- Run in: Supabase Dashboard → SQL Editor → New query → paste ALL → Run
--         (run AFTER supabase/schema.sql; safe to re-run, idempotent)
--
-- WHAT IT BUILDS
--   profiles.is_admin flag + a public.is_admin() helper
--   + Admin policies: full product/category control, all-order access,
--     messages/subscribers read + delete, member profiles read
--   + Storage uploads restricted to admins (public READ stays open)
--
-- Security model: the browser keeps using the anon/publishable key.
-- Admin rights come from the signed-in user's is_admin flag, enforced by
-- RLS on the server. The service_role key is never used in the frontend.
-- ============================================================================

-- 1. Admin flag on profiles -------------------------------------------------
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Helper used inside policies (security definer: RLS-proof read of the flag)
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

-- 2. Catalog — full control for admins --------------------------------------
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

-- 3. Orders — admins see and progress every order ----------------------------
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

-- 4. Profiles — admins can inspect members ------------------------------------
drop policy if exists "profiles_admin_select_all" on public.profiles;
create policy "profiles_admin_select_all" on public.profiles
  for select to authenticated using (public.is_admin());

-- 5. Messages + subscribers — admin-only read (was any authenticated),
--    admins can delete after handling ------------------------------------------
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

-- 6. Storage — uploads limited to admins in the site buckets ------------------
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
-- 7. YOUR ADMIN ACCOUNT — 2 minutes
--
--   a) Supabase Dashboard → Authentication → Users → "Add user" →
--      "Create new user" → set the email + password and enable
--      "Auto Confirm User" (no email validation needed).
--
--   b) Promote that user — must exist first, replace with YOUR email:
--
--      update public.profiles set is_admin = true
--      where email = 'admin@theoriginalfit.com';
--
--   Alternative: sign up on the site's login page, confirm the emailed link,
--   then run the same UPDATE with that email.
--
--   Remove admin rights later:
--      update public.profiles set is_admin = false where email = '...';
--   The admin page lives at:  pages/admin.html
-- ============================================================================
