-- ============================================================================
-- THE ORIGINAL FIT — migration 0010
-- Hero image slider / carousel (admin-managed, Supabase Storage + hero_slides table)
-- ============================================================================

-- Storage bucket for hero slide images (public read, admin write)
insert into storage.buckets (id, name, public)
values ('hero-images', 'hero-images', true)
on conflict (id) do nothing;

-- Hero slides table
create table if not exists hero_slides (
  id uuid default gen_random_uuid() primary key,
  image_url text not null,
  alt_text text,
  link_url text,                -- optional: clicking the slide opens this URL
  sort_order int default 0 not null,
  is_active boolean default true not null,
  created_at timestamptz default now() not null
);

-- RLS: everyone can read ACTIVE slides (storefront fetches them)
alter table hero_slides enable row level security;

create policy "Public can view active hero slides"
  on hero_slides for select
  using (is_active = true);

create policy "Admins manage all hero slides"
  on hero_slides for all
  using (auth.uid() in (select id from profiles where is_admin))
  with check (auth.uid() in (select id from profiles where is_admin));

-- Storage RLS: public read, admin write
create policy "Public can view hero images"
  on storage.objects for select
  using (bucket_id = 'hero-images');

create policy "Admins can upload hero images"
  on storage.objects for insert
  with check (bucket_id = 'hero-images'
    and auth.uid() in (select id from profiles where is_admin));

create policy "Admins can update hero images"
  on storage.objects for update
  using (bucket_id = 'hero-images'
    and auth.uid() in (select id from profiles where is_admin));

create policy "Admins can delete hero images"
  on storage.objects for delete
  using (bucket_id = 'hero-images'
    and auth.uid() in (select id from profiles where is_admin));

-- Index for ordered fetch
create index if not exists idx_hero_slides_sort_active
  on hero_slides (sort_order, is_active, created_at);

-- ============================================================================
