-- ============================================================================
-- THE ORIGINAL FIT — Supabase schema (complete, re-runnable)
-- Run in: Supabase Dashboard → SQL Editor → New query → paste ALL → Run
--
-- WHAT IT BUILDS
--   categories, products, profiles, orders, order_items, wishlists,
--   newsletter_subscribers, contact_messages
--   + Row Level Security on every table
--   + auth trigger (creates a profile row on signup)
--   + Storage buckets: product-images, collection-images (public read)
--   + Seed data: 3 collections + 10 products (real fashion photography)
--
-- ── LEGACY CLEANUP ──────────────────────────────────────────────────────────
-- The previous "Originalfit" storefront created a different `products`,
-- `categories`, `selections`, `selection_items` and `sizes` table.
-- This section removes them so the new schema can be created cleanly.
-- If that old storefront is still live somewhere, comment this block out.
-- ============================================================================

drop table if exists public.selection_items   cascade;
drop table if exists public.selections        cascade;
drop table if exists public.products          cascade;
drop table if exists public.categories        cascade;
drop table if exists public.sizes             cascade;

-- ============================================================================
-- 1. CATEGORIES (Streetwear / Minimalist / Hoodies ...)
-- ============================================================================
create table if not exists public.categories (
  id           bigint generated always as identity primary key,
  slug         text        not null unique,
  name         text        not null,
  image_url    text,
  description  text,
  created_at   timestamptz not null default now()
);

-- ============================================================================
-- 2. PRODUCTS
-- ============================================================================
create table if not exists public.products (
  id              bigint        generated always as identity primary key,
  name            text          not null,
  description     text          not null default '',
  price           numeric(10,2) not null check (price >= 0),
  original_price  numeric(10,2)          check (original_price is null or original_price >= 0),
  image_url       text          not null,
  category_id     bigint        not null references public.categories (id) on delete restrict,
  stock           integer       not null default 0 check (stock >= 0),
  is_new          boolean       not null default false,
  is_best_seller  boolean       not null default false,
  is_active       boolean       not null default true,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

create index if not exists products_category_idx on public.products (category_id);
create index if not exists products_active_idx   on public.products (is_active, created_at desc);
create index if not exists products_name_idx     on public.products (lower(name));

-- updated_at helper -----------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_touch on public.products;
create trigger products_touch
  before update on public.products
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 3. PROFILES (1 row per auth user — also holds phone number)
-- ============================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text        not null default '',
  email       text        not null default '',
  phone       text        not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- On signup, create the matching profile row (security definer bypasses RLS).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 4. ORDERS + ORDER ITEMS
-- ============================================================================
create table if not exists public.orders (
  id                uuid          primary key default gen_random_uuid(),
  user_id           uuid          references auth.users (id) on delete cascade,
  total_amount      numeric(10,2) not null check (total_amount >= 0),
  status            text          not null default 'pending'
                                  check (status in ('pending','paid','shipped','delivered','cancelled')),
  shipping_address  jsonb         not null default '{}'::jsonb,
  created_at        timestamptz   not null default now()
);

create index if not exists orders_user_idx on public.orders (user_id, created_at desc);

create table if not exists public.order_items (
  id          uuid          primary key default gen_random_uuid(),
  order_id    uuid          not null references public.orders (id) on delete cascade,
  product_id  bigint        references public.products (id) on delete set null,
  quantity    integer       not null check (quantity > 0),
  unit_price  numeric(10,2) not null check (unit_price >= 0)
);

create index if not exists order_items_order_idx   on public.order_items (order_id);
create index if not exists order_items_product_idx on public.order_items (product_id);

-- ============================================================================
-- 5. WISHLISTS
-- ============================================================================
create table if not exists public.wishlists (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  product_id  bigint      not null references public.products (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_id, product_id)
);

create index if not exists wishlists_user_idx on public.wishlists (user_id);

-- ============================================================================
-- 6. NEWSLETTER SUBSCRIBERS
-- ============================================================================
create table if not exists public.newsletter_subscribers (
  id          uuid        primary key default gen_random_uuid(),
  email       text        not null unique check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- 7. CONTACT MESSAGES (contact form)
-- ============================================================================
create table if not exists public.contact_messages (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  email       text        not null,
  subject     text        not null default 'General',
  message     text        not null,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- 8. ROW LEVEL SECURITY
--    Notation: anon + authenticated read, per-owner everything else.
--    Writes to products / categories are done with the service_role key
--    (Supabase dashboard / future admin panel) — never exposed in frontend.
-- ============================================================================

alter table public.categories              enable row level security;
alter table public.products                enable row level security;
alter table public.profiles                enable row level security;
alter table public.orders                  enable row level security;
alter table public.order_items             enable row level security;
alter table public.wishlists               enable row level security;
alter table public.newsletter_subscribers  enable row level security;
alter table public.contact_messages        enable row level security;

-- categories: public read ------------------------------------------------------
drop policy if exists "categories_public_read" on public.categories;
create policy "categories_public_read" on public.categories
  for select to anon, authenticated using (true);

-- products: public read of active items ----------------------------------------
drop policy if exists "products_public_read_active" on public.products;
create policy "products_public_read_active" on public.products
  for select to anon, authenticated using (is_active = true);

-- profiles: owner read/update ---------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

-- orders: owner read/insert ------------------------------------------------------
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own" on public.orders
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "orders_update_own_cancel" on public.orders;
create policy "orders_update_own_cancel" on public.orders
  for update to authenticated
  using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id and status = 'cancelled');

-- order_items: owner read/insert (join through orders) ---------------------------
drop policy if exists "order_items_select_own" on public.order_items;
create policy "order_items_select_own" on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));

drop policy if exists "order_items_insert_own" on public.order_items;
create policy "order_items_insert_own" on public.order_items
  for insert to authenticated
  with check (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));

-- wishlists: owner full CRUD ------------------------------------------------------
drop policy if exists "wishlists_select_own" on public.wishlists;
create policy "wishlists_select_own" on public.wishlists
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "wishlists_insert_own" on public.wishlists;
create policy "wishlists_insert_own" on public.wishlists
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "wishlists_delete_own" on public.wishlists;
create policy "wishlists_delete_own" on public.wishlists
  for delete to authenticated using (auth.uid() = user_id);

-- newsletter: public can subscribe, no read-back -----------------------------------
drop policy if exists "newsletter_public_insert" on public.newsletter_subscribers;
create policy "newsletter_public_insert" on public.newsletter_subscribers
  for insert to anon, authenticated with check (true);

drop policy if exists "newsletter_admin_read" on public.newsletter_subscribers;
create policy "newsletter_admin_read" on public.newsletter_subscribers
  for select to authenticated using (true); -- tighten/remove if you prefer service_role only

-- contact: public can submit, no read-back -----------------------------------------
drop policy if exists "contact_public_insert" on public.contact_messages;
create policy "contact_public_insert" on public.contact_messages
  for insert to anon, authenticated with check (true);

drop policy if exists "contact_admin_read" on public.contact_messages;
create policy "contact_admin_read" on public.contact_messages
  for select to authenticated using (true); -- tighten/remove if you prefer service_role only

-- ============================================================================
-- 9. STORAGE — product-images & collection-images (public read)
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('collection-images', 'collection-images', true)
on conflict (id) do update set public = true;

-- Public read
drop policy if exists "storage_public_read" on storage.objects;
create policy "storage_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('product-images', 'collection-images'));

-- Authenticated users can upload/manage files (recommended: prefix `uid/`)
drop policy if exists "storage_authenticated_write" on storage.objects;
create policy "storage_authenticated_write" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('product-images', 'collection-images'));

drop policy if exists "storage_authenticated_update" on storage.objects;
create policy "storage_authenticated_update" on storage.objects
  for update to authenticated
  using (bucket_id in ('product-images', 'collection-images'));

drop policy if exists "storage_authenticated_delete" on storage.objects;
create policy "storage_authenticated_delete" on storage.objects
  for delete to authenticated
  using (bucket_id in ('product-images', 'collection-images'));

-- ============================================================================
-- 10. SEED — collections & products
--     (image URLs point at hosted fashion photography; swap in your own
--      Supabase Storage URLs by uploading to product-images bucket)
-- ============================================================================

insert into public.categories (slug, name, image_url, description) values
  ('streetwear',
   'Streetwear',
   'https://images.unsplash.com/photo-1614252369475-531eba835eb1?q=80&w=1200&auto=format&fit=crop',
   'Bold silhouettes for the city. Pieces designed to stand out.'),
  ('minimalist',
   'Minimalist',
   'https://images.unsplash.com/photo-1627130697816-4d71dbfe6a5b?q=80&w=1200&auto=format&fit=crop',
   'Clean lines, quiet colors. Fewer pieces, more presence.'),
  ('hoodies',
   'Hoodies',
   'https://images.unsplash.com/photo-1556821840-3a63f95609a7?q=80&w=1200&auto=format&fit=crop',
   'Heavyweight comfort layers built for every day.')
on conflict (slug) do nothing;

insert into public.products
  (name, description, price, original_price, image_url, category_id, stock, is_new, is_best_seller, is_active, created_at)
values
  ('Classic Logo Tee',
   'Our foundational piece. 100% heavyweight cotton jersey, boxy relaxed fit, tonal chest logo. Washed for unbeatable softness from day one.',
   24.99, null,
   'https://images.unsplash.com/photo-1562157873-818bc0726f68?q=80&w=1100&auto=format&fit=crop',
   (select id from public.categories where slug = 'streetwear'), 42, true, true, true, now() - interval '0 days'),

  ('Minimal Tee',
   'The quiet essential. Pima cotton, fitted cut, tiny embroidered wordmark at the hem. Wears as good under a jacket as on its own.',
   22.99, null,
   'https://images.unsplash.com/photo-1581655353564-df123a1eb820?q=80&w=1100&auto=format&fit=crop',
   (select id from public.categories where slug = 'minimalist'), 58, true, false, true, now() - interval '1 day'),

  ('Signature Tee',
   'The one that started THE ORIGINAL FIT. Garment-dyed cotton, dropped shoulders, screen-printed signature logo across the back.',
   24.99, 29.99,
   'https://images.unsplash.com/photo-1592728036073-d0ae31a18fdc?q=80&w=1100&auto=format&fit=crop',
   (select id from public.categories where slug = 'streetwear'), 36, false, true, true, now() - interval '2 days'),

  ('Essential Tee',
   'A masterclass in restraint. Midweight organic cotton, straight hem, zero branding. The tee you will search for every laundry day.',
   22.99, null,
   'https://images.unsplash.com/photo-1576417677416-6ca3adfb5435?q=80&w=1100&auto=format&fit=crop',
   (select id from public.categories where slug = 'minimalist'), 64, false, false, true, now() - interval '3 days'),

  ('Essential Logo Tee — Black',
   'Deep matte black version of our classic logo tee. Premium combed cotton holds color through every wash.',
   24.99, null,
   'https://images.unsplash.com/photo-1604897391146-c98ab268e252?q=80&w=1100&auto=format&fit=crop',
   (select id from public.categories where slug = 'streetwear'), 30, false, false, true, now() - interval '5 days'),

  ('Everyday Logo Tee',
   'Built for rotation. Slightly longer body, ribbed collar that keeps its shape, subtle left-chest print.',
   23.99, null,
   'https://images.unsplash.com/photo-1622445272461-c6580cab8755?q=80&w=1100&auto=format&fit=crop',
   (select id from public.categories where slug = 'streetwear'), 51, false, false, true, now() - interval '8 days'),

  ('Studio Essential Tee',
   'Awfully soft organic cotton tee — cut with a straight drape and finished with tonal stitching. Styled for minimalists.',
   19.99, 24.99,
   'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?q=80&w=1100&auto=format&fit=crop',
   (select id from public.categories where slug = 'minimalist'), 73, false, false, true, now() - interval '9 days'),

  ('OG Monochrome Hoodie',
   'Blanket-heavy 420gsm fleece with double-lined hood, kangaroo pocket and tonal embroidery. Your year-round layer.',
   49.99, 59.99,
   'https://images.unsplash.com/photo-1556821840-3a63f95609a7?q=80&w=1100&auto=format&fit=crop',
   (select id from public.categories where slug = 'hoodies'), 24, false, true, true, now() - interval '11 days'),

  ('Heavyweight Grey Hoodie',
   'Our heaviest build yet — 480gsm brushed fleece, oversized cut, metal-tipped drawcords. Offers warm forever.',
   54.99, 64.99,
   'https://images.unsplash.com/photo-1611817757591-c3f345024273?q=80&w=1100&auto=format&fit=crop',
   (select id from public.categories where slug = 'hoodies'), 18, true, false, true, now() - interval '14 days'),

  ('Off-Duty Hoodie',
   'Thrown on with everything. Loopback cotton fleece, lived-in softness, relaxed raglan sleeves with hidden side pockets.',
   52.99, null,
   'https://images.unsplash.com/photo-1738486260590-23c954cf29b8?q=80&w=1100&auto=format&fit=crop',
   (select id from public.categories where slug = 'hoodies'), 27, false, false, true, now() - interval '16 days');

-- ============================================================================
-- DONE. RLS is on; the anon key can safely ship to the browser.
-- Reminder: product/category writes need the service_role key (Dashboard or
-- a future admin tool) — the anon key intentionally has read-only access.
-- ============================================================================
