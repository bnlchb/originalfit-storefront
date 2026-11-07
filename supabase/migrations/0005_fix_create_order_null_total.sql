-- ============================================================================
-- 0005_fix_create_order_null_total.sql
-- THE ORIGINAL FIT — migrations/0005
--
-- Fixes the checkout failure:
--   "null value in column "total_amount" of relation "orders" violates
--    not-null constraint"  (HTTP 400, PG 23502)
--
-- Root cause (reproduced live, pre-fix):
--   In PL/pgSQL, SELECT … INTO with ZERO matching rows assigns NULL to every
--   target variable. create_order()'s idempotency pre-check ran that lookup
--   for EVERY submit carrying a fresh client_ref — i.e., every first submit —
--   and thereby NULLed the v_subtotal / v_total accumulators that the DECLARE
--   section had initialized to 0. The item loop then accumulated
--   NULL + price*qty = NULL, and the orders insert received total_amount NULL.
--   (A call WITHOUT client_ref skipped the block and priced correctly:
--   2 × 200 DH + 30 DH shipping = 430 DH — proving the math itself was fine.)
--
-- Fix:
--   * after the idempotency lookup, re-initialize the accumulators when no
--     prior order exists (and branch on FOUND, the canonical check)
--   * guard the unique_violation fallback: in the concurrent double-submit
--     case the conflicting row may not be visible inside our transaction yet
--     — raise a clean retry message instead of letting order_items hit a
--     NULL order_id
--
--create-or-replace only: the browser never sends prices, totals, status or
-- ownership — that part of the design is unchanged.
-- ============================================================================

create or replace function public.create_order(
  p_items      jsonb,              -- [{"id": <product id>, "qty": 1..50}]
  p_address    jsonb,              -- checkout form fields
  p_client_ref uuid default null   -- one per submit (double-click / retry safe; LAST because PG requires parameters after a defaulted one to have defaults too — supabase-js calls with named args, so order is irrelevant to the browser)
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
  -- NOTE: SELECT…INTO with no rows NULLs EVERY target — the re-initialization
  -- below is MANDATORY or v_subtotal/v_total stay NULL for all first submits.
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
    -- a concurrent request claimed this client_ref; its row may not be
    -- visible inside this transaction yet — fail cleanly with a retry hint
    -- instead of writing order_items against a NULL order id.
    select id into v_order_id from public.orders where client_ref = p_client_ref;
    if v_order_id is null then
      raise exception 'Order is being processed — please try again in a moment.';
    end if;
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
  'Secure order creation: auth.uid() resolved server-side, prices re-read from public.products, address sanitized, totals computed here — client-supplied prices/totals/status are never trusted. Fixed in 0005: accumulator re-init after a no-row idempotency lookup.';

-- VERIFY (should show the new function; then place a real test order):
--   select proname from pg_proc where nspname = 'public' and proname = 'create_order';
