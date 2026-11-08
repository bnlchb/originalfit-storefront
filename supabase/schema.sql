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
  images          jsonb         not null default '[]'::jsonb
                    check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 10),
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
-- ============================================================================
-- 2b. PRODUCT SIZES — per-size stock (migration 0009)
--     Optional per product: NO size rows → the product keeps the legacy
--     behavior where all six sizes follow products.stock. The trigger keeps
--     products.stock = sum(size rows) once size rows exist.
-- ============================================================================
create table if not exists public.product_sizes (
  product_id bigint  not null references public.products (id) on delete cascade,
  size       text    not null check (size in ('XS','S','M','L','XL','XXL')),
  stock      integer not null default 0 check (stock >= 0),
  primary key (product_id, size)
);

create or replace function public.sync_product_stock_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pid bigint := coalesce(new.product_id, old.product_id);
begin
  update public.products p
     set stock = coalesce((select sum(ps.stock)
                             from public.product_sizes ps
                            where ps.product_id = v_pid), 0)
   where p.id = v_pid;
  return null; -- AFTER trigger's return value is ignored
end;
$$;

drop trigger if exists trg_sync_product_stock_total on public.product_sizes;
create trigger trg_sync_product_stock_total
after insert or update or delete on public.product_sizes
for each row execute function public.sync_product_stock_total();
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
  is_admin    boolean     not null default false,
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
-- 3c. ADMIN SIGN-IN THROTTLE (migrations 0006/0007)
-- Aggressive PER-ATTEMPT ladder, server-enforced by public.admin_login_lock():
-- EVERY failed admin sign-in advances the lock level immediately (no
-- 5-attempt threshold): 1m → 5m → 20m → 20m → 20m → 20m → 30m → 1h → 2h →
-- 6h → 12h → 24h cap. Lock expiry never resets the counter; the ONLY reset
-- is a successful sign-in (which wipes the identifier's failures). All
-- counters/timestamps live in admin_login_attempts — RLS ON, ZERO policies
-- (only the definer function touches it; the password is never stored).
-- Server state is keyed to the normalized identifier + best-effort client
-- IP, so refreshing, new tabs or another browser cannot bypass. A separate
-- spray guard gives ≥20 failures from one IP in 10 min a 10-min cooldown.
-- ============================================================================
create table if not exists public.admin_login_attempts (
  id         bigint      generated always as identity primary key,
  the_lock   text        not null,                       -- normalized login identifier
  ip         text        not null default 'unknown',     -- best-effort client address
  success    boolean     not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_login_attempts_lock_idx
  on public.admin_login_attempts (the_lock, created_at desc);
create index if not exists admin_login_attempts_ip_idx
  on public.admin_login_attempts (ip, created_at desc);

alter table public.admin_login_attempts enable row level security;

create or replace function public.admin_login_lock(
  p_login   text,                -- email typed in the sign-in form
  p_success boolean default null -- null = status only | true = success | false = failure
) returns jsonb                 -- {"locked", "retry_after" (s), "fails"}
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key      text;
  v_ip       text;
  v_addr     text;
  v_fails    integer;
  v_last     timestamptz;
  v_dur      integer;
  v_ip_last  timestamptz;
  v_ip_fails integer;
  v_locked   boolean := false;
  v_wait     integer := 0;
begin
  v_key := left(btrim(lower(coalesce(p_login, ''))), 120);
  if char_length(v_key) < 3 or position('@' in v_key) = 0 then
    return jsonb_build_object('locked', false, 'retry_after', 0, 'fails', 0);
  end if;

  -- best-effort client ip: PostgREST exposes request headers as a GUC
  begin
    v_addr := split_part(
      coalesce(nullif(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''),
               inet_client_addr()::text), ',', 1);
  exception when others then
    v_addr := null;
  end;
  v_ip := coalesce(left(btrim(coalesce(v_addr, 'unknown')), 64), 'unknown');

  -- ledger horizon: the ladder must survive multi-hour/24h locks, so the
  -- window/count horizon is 7 days; nothing older matters
  delete from public.admin_login_attempts where created_at < now() - interval '7 days';

  -- successful authentication: the ONLY thing that resets the progression
  if p_success is true then
    delete from public.admin_login_attempts where the_lock = v_key and not success;
    return jsonb_build_object('locked', false, 'retry_after', 0, 'fails', 0);
  end if;

  -- every failed attempt is one row = one level advance
  if p_success is false then
    insert into public.admin_login_attempts (the_lock, ip, success) values (v_key, v_ip, false);
  end if;

  -- counter + last failure time over the 7-day window (expiry never resets it)
  select count(*), max(created_at) into v_fails, v_last
    from public.admin_login_attempts
   where the_lock = v_key and not success and created_at >= now() - interval '7 days';

  -- aggressive per-attempt ladder (seconds); rows 4-6 clamped to be
  -- non-decreasing as the request's own bullets demand
  if v_fails >= 1 then
    v_dur := (array[
      60,        -- 1: 1 minute
      300,       -- 2: 5 minutes
      1200,      -- 3: 20 minutes
      1200,      -- 4: 20 min (requested 5 min — non-increasing, clamped)
      1200,      -- 5: 20 min (requested 10 min — non-increasing, clamped)
      1200,      -- 6: 20 minutes
      1800,      -- 7: 30 minutes
      3600,      -- 8: 1 hour
      7200,      -- 9: 2 hours
      21600,     -- 10: 6 hours
      43200,     -- 11: 12 hours
      86400      -- 12+: 24 hours
    ])[least(v_fails, 12)];

    if v_last + make_interval(secs => v_dur) > now() then
      v_locked := true;
      v_wait := greatest(1, extract(epoch from (v_last + make_interval(secs => v_dur) - now()))::integer);
    end if;
  end if;

  -- spray guard: one address hammering many identifiers in a burst
  if v_ip <> 'unknown' then
    select count(*), max(created_at) into v_ip_fails, v_ip_last
      from public.admin_login_attempts
     where ip = v_ip and not success and created_at >= now() - interval '10 minutes';
    if v_ip_fails >= 20 then
      v_locked := true;
      v_wait := greatest(v_wait, greatest(1, extract(epoch from (v_ip_last + interval '10 minutes' - now()))::integer));
    end if;
  end if;

  return jsonb_build_object('locked', v_locked, 'retry_after', v_wait, 'fails', coalesce(v_fails, 0));
end;
$$;

comment on function public.admin_login_lock(text, boolean) is
  'Aggressive per-attempt admin sign-in throttle (0007): every failure advances the lock immediately — 1m/5m/20m/20m/20m/20m/30m/1h/2h/6h/12h/24h; expiry never resets; only a successful sign-in wipes; server-side ledger, passwords never stored.';

revoke all on function public.admin_login_lock(text, boolean) from public;
grant execute on function public.admin_login_lock(text, boolean) to anon, authenticated;

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
  client_ref        uuid,                   -- idempotency key minted per submit (migration 0004)
  created_at        timestamptz   not null default now()
);

create index if not exists orders_user_idx on public.orders (user_id, created_at desc);

-- idempotency: one order per client_ref (nullable → existing rows unaffected)
create unique index if not exists orders_client_ref_key
  on public.orders (client_ref) where client_ref is not null;

create table if not exists public.order_items (
  id          uuid          primary key default gen_random_uuid(),
  order_id    uuid          not null references public.orders (id) on delete cascade,
  product_id  bigint        references public.products (id) on delete set null,
  quantity    integer       not null check (quantity > 0),
  unit_price  numeric(10,2) not null check (unit_price >= 0),
  size        text          not null default 'M' check (size in ('XS','S','M','L','XL','XXL'))
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
--    Catalog/news/message writes: admin-only via profiles.is_admin — the
--    frontend keeps using the anon/publishable key only. (Promote admins with
--    supabase/migrations/0002_admin_console_rls.sql.)
-- ============================================================================

alter table public.categories              enable row level security;
alter table public.products                enable row level security;
alter table public.product_sizes           enable row level security;
alter table public.profiles                enable row level security;
alter table public.orders                  enable row level security;
alter table public.order_items             enable row level security;
alter table public.wishlists               enable row level security;
alter table public.newsletter_subscribers  enable row level security;
alter table public.contact_messages        enable row level security;

-- Admin helper: single source of truth for every admin policy. Security
-- definer keeps the flag readable even though profiles RLS is owner-only.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- ============================================================================
-- 3b. SECURE ORDER CREATION (migration 0004)
-- Every order is written by the security-definer function public.create_order().
-- The browser never sends prices, totals, status or ownership: the function
-- re-reads prices from public.products, resolves the customer with auth.uid(),
-- sanitizes the shipping address and computes shipping + total. RLS stays
-- ENABLED on orders/order_items for all roles — there are deliberately NO
-- client INSERT policies after this section.
-- ============================================================================
create or replace function public.create_order(
  p_items      jsonb,              -- [{"id": <product id>, "qty": 1..50, "size": "M"}] — "size" optional (default "M")
  p_address    jsonb,              -- checkout form fields
  p_client_ref uuid default null   -- must be LAST: PG requires parameters after a defaulted one to have defaults too — supabase-js calls with named args, so order is irrelevant to the browser
) returns jsonb                    -- {"id", "subtotal", "shipping", "total"}
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid              := auth.uid();   -- resolved SERVER-side
  v_subtotal    numeric(10,2)     := 0;
  v_shipping    numeric(10,2)     := 0;
  v_total       numeric(10,2)     := 0;
  v_order_id    uuid;
  v_addr        jsonb;
  v_item        jsonb;
  v_prod        public.products%rowtype;
  v_pid         bigint;
  v_qty         integer;
  v_size        text;
  v_clean_items jsonb := '[]'::jsonb;
begin
  -- idempotency: a retried submit returns the order it already created
  -- instead of writing a duplicate.
  -- NOTE: SELECT…INTO with no rows NULLs EVERY target — the re-initialization
  -- below is MANDATORY or v_subtotal/v_total stay NULL for all first submits
  -- (root cause of the 23502 total_amount bug, fixed in migration 0005).
  if p_client_ref is not null then
    select o.id, o.total_amount,
           (select coalesce(sum(i.unit_price * i.quantity), 0)
              from public.order_items i where i.order_id = o.id)
      into v_order_id, v_total, v_subtotal
      from public.orders o
     where o.client_ref = p_client_ref;
    if found then
      return jsonb_build_object('id', v_order_id, 'subtotal', v_subtotal,
                                'shipping', v_total - v_subtotal, 'total', v_total);
    end if;
    -- no prior order for this ref: restore the working accumulators
    v_order_id := null;
    v_subtotal := 0;
    v_total    := 0;
    v_shipping := 0;
  end if;

  -- validate items ------------------------------------------------------------
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Order contains no items.';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many order lines (max 50).';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if v_item->>'id' is null or (v_item->>'id') !~ '^[0-9]+$' then
      raise exception 'Invalid product reference.';
    end if;
    v_pid := (v_item->>'id')::bigint;

    if jsonb_typeof(v_item->'qty') <> 'number'
       or (v_item->>'qty')::numeric <> floor((v_item->>'qty')::numeric)
       or (v_item->>'qty')::numeric < 1
       or (v_item->>'qty')::numeric > 50 then
      raise exception 'Invalid quantity for product %.', v_pid;
    end if;
    v_qty := (v_item->>'qty')::integer;

    -- size: optional (payloads sent before 0009 keep ordering as "M")
    v_size := upper(coalesce(nullif(btrim(v_item->>'size'), ''), 'M'));
    if v_size not in ('XS','S','M','L','XL','XXL') then
      raise exception 'Invalid size for product %.', v_pid;
    end if;

    -- re-price from the live catalog: the browser's price is not trusted here
    select * into v_prod from public.products where id = v_pid and is_active = true;
    if not found then
      raise exception 'Product % is not available.', coalesce(v_prod.name, v_pid::text);
    end if;

    -- stock: size rows are authoritative when they exist; for legacy products
    -- (no size rows) the product-level stock is decremented as before
    if exists (select 1 from public.product_sizes where product_id = v_pid) then
      if not exists (select 1 from public.product_sizes where product_id = v_pid and size = v_size) then
        raise exception 'Size % of "%" is not available.', v_size, v_prod.name;
      end if;
      -- atomic, race-safe decrement: stock >= qty is part of the predicate
      update public.product_sizes
         set stock = stock - v_qty
       where product_id = v_pid and size = v_size and stock >= v_qty;
      if not found then
        raise exception 'Size % of "%" is out of stock for the requested quantity.', v_size, v_prod.name;
      end if;
    else
      update public.products
         set stock = stock - v_qty
       where id = v_pid and stock >= v_qty;
      if not found then
        raise exception '"%" is out of stock for the requested quantity.', v_prod.name;
      end if;
    end if;

    v_subtotal := v_subtotal + round(v_prod.price * v_qty, 2);
    v_clean_items := v_clean_items || jsonb_build_object(
      'product_id', v_pid, 'quantity', v_qty, 'unit_price', v_prod.price, 'size', v_size);
  end loop;

  -- validate + sanitize the shipping address -----------------------------------
  -- Whitelisted keys only; blank-but-optional fields are kept out cleanly.
  v_addr := jsonb_build_object(
    'full_name', left(btrim(coalesce(p_address->>'full_name', '')), 80),
    'phone',     left(btrim(coalesce(p_address->>'phone', '')), 24),
    'email',     left(btrim(coalesce(p_address->>'email', '')), 120),
    'address',   left(btrim(coalesce(p_address->>'address', '')), 200),
    'city',      left(btrim(coalesce(p_address->>'city', '')), 80),
    'zip',       left(btrim(coalesce(p_address->>'zip', '')), 12),
    'country',   left(btrim(coalesce(nullif(p_address->>'country', ''), 'Morocco')), 80)
  );

  if char_length(v_addr->>'full_name') < 2 then raise exception 'Shipping name is required.'; end if;
  if char_length(v_addr->>'address')   < 3 then raise exception 'Shipping address is required.'; end if;
  if char_length(v_addr->>'city')      < 2 then raise exception 'City is required.'; end if;
  if char_length(v_addr->>'zip')       < 2 then raise exception 'Postal code is required.'; end if;
  if v_addr->>'email' <> ''
     and (v_addr->>'email') !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+' then
    raise exception 'Invalid email address.';
  end if;

  -- compute + write ------------------------------------------------------------
  -- Shipping must stay in sync with src/js/cart.js: FREE_SHIPPING_AT = 500,
  -- STANDARD_SHIPPING = 30 (DH). Computed server-side only.
  v_shipping := case when v_subtotal >= 500 then 0 else 30 end;
  v_total := v_subtotal + v_shipping;

  begin
    insert into public.orders (user_id, total_amount, shipping_address, client_ref)
      values (v_uid, v_total, v_addr, p_client_ref)
      returning id into v_order_id;
  exception when unique_violation then
    -- a concurrent request claimed this client_ref. Never adopt another
    -- transaction's order: our size-stock decrements must roll back with us.
    -- A retry re-enters the idempotency lookup above and returns same order.
    raise exception 'Order is being processed — please try again in a moment.';
  end;

  insert into public.order_items (order_id, product_id, quantity, unit_price, size)
    select v_order_id,
           (e->>'product_id')::bigint,
           (e->>'quantity')::integer,
           (e->>'unit_price')::numeric,
           (e->>'size')::text
      from jsonb_array_elements(v_clean_items) e;

  return jsonb_build_object('id', v_order_id, 'subtotal', v_subtotal,
                            'shipping', v_shipping, 'total', v_total);
end;
$$;

comment on function public.create_order(jsonb, jsonb, uuid) is
  'Secure order creation (sizes edition, 0009): auth.uid() resolved server-side, prices re-read from public.products, per-item size validated against the canonical set, stock enforced and decremented per size (products.stock fallback for legacy rows), address sanitized, totals computed here. Size-stock decrement and order write share one transaction.';

-- order writes are ONLY possible through create_order(); no anon/authenticated
-- table-level INSERT survives (these guards also converge partially-migrated DBs)
drop policy if exists "orders_insert_own"        on public.orders;
drop policy if exists "orders_insert_guest"      on public.orders;
drop policy if exists "order_items_insert_own"   on public.order_items;
drop policy if exists "order_items_insert_guest" on public.order_items;

revoke execute on function public.create_order(jsonb, jsonb, uuid) from public;
grant execute on function public.create_order(jsonb, jsonb, uuid) to anon, authenticated;

-- categories: public read ------------------------------------------------------
drop policy if exists "categories_public_read" on public.categories;
create policy "categories_public_read" on public.categories
  for select to anon, authenticated using (true);

drop policy if exists "categories_admin_all" on public.categories;
create policy "categories_admin_all" on public.categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- products: public read of active items ----------------------------------------
drop policy if exists "products_public_read_active" on public.products;
create policy "products_public_read_active" on public.products
  for select to anon, authenticated using (is_active = true);

drop policy if exists "products_admin_all" on public.products;
create policy "products_admin_all" on public.products
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- product_sizes: public read (every size must show its availability) ----------
drop policy if exists "product_sizes_public_read" on public.product_sizes;
create policy "product_sizes_public_read" on public.product_sizes
  for select to anon, authenticated using (true);

drop policy if exists "product_sizes_admin_all" on public.product_sizes;
create policy "product_sizes_admin_all" on public.product_sizes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

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

drop policy if exists "profiles_admin_select_all" on public.profiles;
create policy "profiles_admin_select_all" on public.profiles
  for select to authenticated using (public.is_admin());

-- orders: owner read, customer cancel-before-shipment. CREATION happens only
-- through public.create_order() (section 3b) — no client INSERT policy exists.
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "orders_update_own_cancel" on public.orders;
create policy "orders_update_own_cancel" on public.orders
  for update to authenticated
  using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id and status = 'cancelled');

drop policy if exists "orders_admin_select_all" on public.orders;
create policy "orders_admin_select_all" on public.orders
  for select to authenticated using (public.is_admin());

drop policy if exists "orders_admin_update_all" on public.orders;
create policy "orders_admin_update_all" on public.orders
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- order_items: owner read; rows are written inside create_order() ----------------
drop policy if exists "order_items_select_own" on public.order_items;
create policy "order_items_select_own" on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));

drop policy if exists "order_items_admin_select_all" on public.order_items;
create policy "order_items_admin_select_all" on public.order_items
  for select to authenticated using (public.is_admin());

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

-- newsletter: public can subscribe, no read-back except admins --------------------
drop policy if exists "newsletter_public_insert" on public.newsletter_subscribers;
create policy "newsletter_public_insert" on public.newsletter_subscribers
  for insert to anon, authenticated with check (true);

drop policy if exists "newsletter_admin_read" on public.newsletter_subscribers;
create policy "newsletter_admin_read" on public.newsletter_subscribers
  for select to authenticated using (public.is_admin());

drop policy if exists "newsletter_admin_delete" on public.newsletter_subscribers;
create policy "newsletter_admin_delete" on public.newsletter_subscribers
  for delete to authenticated using (public.is_admin());

-- contact: public can submit, no read-back except admins --------------------------
drop policy if exists "contact_public_insert" on public.contact_messages;
create policy "contact_public_insert" on public.contact_messages
  for insert to anon, authenticated with check (true);

drop policy if exists "contact_admin_read" on public.contact_messages;
create policy "contact_admin_read" on public.contact_messages
  for select to authenticated using (public.is_admin());

drop policy if exists "contact_admin_delete" on public.contact_messages;
create policy "contact_admin_delete" on public.contact_messages
  for delete to authenticated using (public.is_admin());

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

-- Authenticated users can upload/manage files — admins in the site buckets only
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
-- 10. SEED — collections (only)
--     The catalog starts EMPTY: create real products from the admin console
--     (with Supabase Storage uploads) so the site serves backend data only.
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

-- multi-photo mirror (0008): legacy single-photo rows become galleries
update public.products
   set images = jsonb_build_array(image_url)
 where images = '[]'::jsonb
   and image_url is not null
   and image_url <> '';

-- ============================================================================
-- DONE. RLS is on; the anon key can safely ship to the browser.
-- Reminder: catalog/news/message writes are admin-only via RLS. Promote an
-- account with supabase/migrations/0002_admin_console_rls.sql — no service_role
-- key is ever used in the frontend.
-- ============================================================================
