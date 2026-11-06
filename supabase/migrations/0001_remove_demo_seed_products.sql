-- ============================================================================
-- 0001_remove_demo_seed_products.sql
-- THE ORIGINAL FIT — migrations/0001
--
-- Removes the 10 placeholder products inserted by schema.sql §10
-- ("Classic Logo Tee" … "Off-Duty Hoodie"). After this runs the catalog is
-- empty: every product must come from a real row created in the ADMIN console.
--
-- Safety (per schema.sql):
--   order_items.product_id  → ON DELETE SET NULL   (order history is kept)
--   wishlists.product_id    → ON DELETE CASCADE    (ghost hearts cleaned up)
--
-- Idempotent: re-running it deletes 0 rows. Safe to paste repeatedly.
-- apply-by-design in the Supabase SQL Editor (runs as service role):
--     Dashboard → SQL Editor → paste whole file → Run
-- ============================================================================

delete from public.products
where name in (
  'Classic Logo Tee',
  'Minimal Tee',
  'Signature Tee',
  'Essential Tee',
  'Essential Logo Tee — Black',
  'Everyday Logo Tee',
  'Studio Essential Tee',
  'OG Monochrome Hoodie',
  'Heavyweight Grey Hoodie',
  'Off-Duty Hoodie'
);

-- OPTIONAL: un-comment to also drop the three demo collections
-- ("Streetwear / Minimalist / Hoodies") after catalog cleanup. category_id is
-- `on delete restrict`, so any remaining product in these collections blocks
-- this unless that product is deleted first.
--
-- delete from public.categories
-- where slug in ('streetwear', 'minimalist', 'hoodies');

-- OPTIONAL: un-comment to rewind the product id sequence after the purge.
-- (By default new admin-created products continue at the next highest id.)
--
-- alter sequence public.products_id_seq restart with 1;

-- VERIFY (run afterwards to confirm a clean state):
--   select count(*) as products_left from public.products;
--   -- expect 0 unless you already created real products
