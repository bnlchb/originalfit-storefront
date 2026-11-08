-- ============================================================================
-- 0009_sizes_per_size.sql
-- THE ORIGINAL FIT — migrations/0009
--
-- Per-size stock system:
--   * product_sizes — every product can carry stock for each of the six
--     canonical sizes (XS/S/M/L/XL/XXL). Publicly readable, admin-writable.
--   * Legacy semantics preserved: a product with NO size rows keeps the old
--     behavior — all sizes follow products.stock (no auto-backfill; the admin
--     console converts a product to per-size on its first size save).
--   * order_items.size — records the purchased size; legacy rows default "M".
--   * create_order() — rewritten: reads the optional "size" field per item
--     (any legacy payload without it continues to order as "M"), rejects
--     sizes outside the canonical set, enforces stock per size (or the
--     product-level stock for legacy products) and decrements the correct
--     row. Decrement, stock check and order write happen inside one
--     transaction, so a failure anywhere rolls the stock back atomically.
--     The concurrent client_ref race now rejects cleanly instead of adopting
--     another transaction's order — a retry re-enters the idempotency
--     lookup and returns the same order.
--   * Trigger sync_product_stock_total — after any product_sizes write the
--     owning product's stock becomes the sum of its size rows, so
--     products.stock (cards, admin table, totals) stays truthful for free.
-- Standalone & idempotent (safe whether schema.sql facets ran or not).
-- ============================================================================

-- 1) product_sizes: stock per canonical size --------------------------------

create table if not exists public.product_sizes (
  product_id bigint  not null references public.products (id) on delete cascade,
  size       text    not null check (size in ('XS','S','M','L','XL','XXL')),
  stock      integer not null default 0 check (stock >= 0),
  primary key (product_id, size)
);

-- 2) order_items.size — the purchased size (legacy rows read as "M") --------

alter table public.order_items add column if not exists size text not null default 'M';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_size_check') then
    alter table public.order_items
      add constraint order_items_size_check
      check (size in ('XS','S','M','L','XL','XXL'));
  end if;
exception when others then null;
end $$;

-- 3) RLS — public read, admin-only writes -----------------------------------

alter table public.product_sizes enable row level security;

drop policy if exists "product_sizes_public_read" on public.product_sizes;
create policy "product_sizes_public_read" on public.product_sizes
  for select to anon, authenticated
  using (true);

drop policy if exists "product_sizes_admin_insert" on public.product_sizes;
create policy "product_sizes_admin_insert" on public.product_sizes
  for insert to authenticated
  with check (public.is_admin ());

drop policy if exists "product_sizes_admin_update" on public.product_sizes;
create policy "product_sizes_admin_update" on public.product_sizes
  for update to authenticated
  using (public.is_admin ())
  with check (public.is_admin ());

drop policy if exists "product_sizes_admin_delete" on public.product_sizes;
create policy "product_sizes_admin_delete" on public.product_sizes
  for delete to authenticated
  using (public.is_admin ());

-- 4) products.stock stays = sum(size rows) automatically --------------------

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

-- 5) create_order() — size-aware, stock-enforcing, still server-priced -------

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

-- keep the function callable by the site's two roles (drop/re-place grants)
revoke execute on function public.create_order(jsonb, jsonb, uuid) from public;
grant execute on function public.create_order(jsonb, jsonb, uuid) to anon, authenticated;

-- VERIFY ---------------------------------------------------------------------
--   select p.name, ps.size, ps.stock
--     from public.product_sizes ps
--     join public.products p on p.id = ps.product_id
--    order by p.id, array_position(array['XS','S','M','L','XL','XXL'], ps.size);
--   select column_name, column_default from information_schema.columns
--    where table_name = 'order_items' and column_name = 'size';
--   (anon REST: GET /rest/v1/product_sizes?select=*  → 200 with rows;
--    anon insert/update/delete → 42501 permission denied)
