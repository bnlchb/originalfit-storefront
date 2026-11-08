-- ============================================================================
-- 0008_product_multi_images.sql
-- THE ORIGINAL FIT — migrations/0008
--
-- Multi-photo support for products (admin console backend only):
--   * products.images  → jsonb array of public storage URLs, up to 10 photos
--     for ONE product. The cover/main photo is mirrored in the existing
--     image_url column (cards, cart line items and order history keep
--     working unchanged), and the cover always sits at index 0 of images.
--   * Reverse mirror for legacy rows: a product that only ever had a
--     single image_url gets images = [ that url ] so the PDP gallery
--     renders out of the box.
--   * Storage: the existing product-images bucket (public read, admin-only
--     write per 0002) is reused — no new bucket, no new RLS.
--   * products table policies are untouched: the new column inherits them.
-- Standalone & idempotent (safe whether schema.sql facets ran or not).
-- ============================================================================

alter table public.products
  add column if not exists images jsonb not null default '[]'::jsonb;

-- shape guard: a jsonb array with at most 10 entries (contents are URL
-- strings; enforced client-side at upload time, capped here too)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_images_check') then
    alter table public.products
      add constraint products_images_check
      check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 10);
  end if;
exception when others then null;
end $$;

-- legacy mirror: single-photo products become 1-photo galleries automatically
update public.products
   set images = jsonb_build_array(image_url)
 where images = '[]'::jsonb
   and image_url is not null
   and image_url <> '';

-- VERIFY ---------------------------------------------------------------------
--   select image_url, images from public.products limit 5;
--   (every non-empty product should show identical cover in both columns)
