-- ============================================================================
-- 0004_secure_order_creation.sql
-- THE ORIGINAL FIT — migrations/0004
--
-- Server-side order creation. EVERY order write goes through ONE
-- security-definer function that the browser cannot override:
--   * ownership is resolved server-side via auth.uid() — clients never send
--     user_id, so a customer cannot create or impersonate another customer
--   * every line is re-priced from public.products at insert time — prices,
--     shipping and totals sent by the browser are ignored
--   * customer data is validated and rewritten into a whitelisted
--     shipping_address document (trim, length caps, default country)
--   * an optional client_ref UUID (minted per submit) makes double submits
--     idempotent at the DB level: the first attempt wins, retries return it
--
-- The four direct client INSERT policies (0001/0002 "orders_insert_own",
-- "order_items_insert_own" and the 0003 guest ones) are removed — after this
-- migration no anon/authenticated direct insert is possible on orders or
-- order_items. RLS stays ENABLED on every table; nothing is weakened.
-- Reads keep their policies (own orders / admin-only) and the admin status
-- update keeps "orders_admin_update_all".
-- ============================================================================

-- 1. idempotency key ---------------------------------------------------------
-- Nullable + partial unique index: existing rows (client_ref NULL) are never
-- touched and the constraint only applies to new submissions.
alter table public.orders add column if not exists client_ref uuid;
create unique index if not exists orders_client_ref_key
  on public.orders (client_ref) where client_ref is not null;

-- 2. the secure order creator ---------------------------------------------------
create or replace function public.create_order(
  p_items      jsonb,              -- [{"id": <product id>, "qty": 1..50}]
  p_address    jsonb,              -- checkout form fields
  p_client_ref uuid default null   -- one per submit (double-click / retry safe; must be LAST — PG requires parameters after a defaulted one to have defaults too — supabase-js calls with named args, so order is irrelevant to the browser)
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
  v_clean_items jsonb := '[]'::jsonb;
begin
  -- idempotency: a retried submit returns the order it already created
  -- instead of writing a duplicate.
  if p_client_ref is not null then
    select o.id, o.total_amount,
           (select coalesce(sum(i.unit_price * i.quantity), 0)
              from public.order_items i where i.order_id = o.id)
      into v_order_id, v_total, v_subtotal
      from public.orders o
     where o.client_ref = p_client_ref;
    if v_order_id is not null then
      return jsonb_build_object('id', v_order_id, 'subtotal', v_subtotal,
                                'shipping', v_total - v_subtotal, 'total', v_total);
    end if;
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

    -- re-price from the live catalog: the browser's price is not trusted here
    select * into v_prod from public.products where id = v_pid and is_active = true;
    if not found then
      raise exception 'Product % is not available.', v_prod.name;
    end if;

    v_subtotal := v_subtotal + round(v_prod.price * v_qty, 2);
    v_clean_items := v_clean_items || jsonb_build_object(
      'product_id', v_pid, 'quantity', v_qty, 'unit_price', v_prod.price);
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
    -- a concurrent request already claimed this client_ref: return theirs
    select id into v_order_id from public.orders where client_ref = p_client_ref;
  end;

  insert into public.order_items (order_id, product_id, quantity, unit_price)
    select v_order_id,
           (e->>'product_id')::bigint,
           (e->>'quantity')::integer,
           (e->>'unit_price')::numeric
      from jsonb_array_elements(v_clean_items) e;

  return jsonb_build_object('id', v_order_id, 'subtotal', v_subtotal,
                            'shipping', v_shipping, 'total', v_total);
end;
$$;

comment on function public.create_order(jsonb, jsonb, uuid) is
  'Secure order creation: auth.uid() resolved server-side, prices re-read from public.products, address sanitized, totals computed here — client-supplied prices/totals/status are never trusted.';

-- 3. lock the table paths — order writes only via the function ----------------
drop policy if exists "orders_insert_own"        on public.orders;
drop policy if exists "orders_insert_guest"      on public.orders;
drop policy if exists "order_items_insert_own"   on public.order_items;
drop policy if exists "order_items_insert_guest" on public.order_items;

-- function-level access: only the web/api roles may call it
revoke execute on function public.create_order(jsonb, jsonb, uuid) from public;
grant execute on function public.create_order(jsonb, jsonb, uuid) to anon, authenticated;

-- VERIFY ---------------------------------------------------------------------
-- Orders/item write policies should list ONLY admin + owner reads + admin update:
--   select tablename, policyname, cmd, roles
--     from pg_policies
--    where schemaname = 'public'
--      and tablename in ('orders','order_items')
--    order by tablename, policyname;
-- Function exists and is executable by anon:
--   select proname, proacl::text[] is null as default_acl
--     from pg_proc where nspname = 'public' and proname = 'create_order';
