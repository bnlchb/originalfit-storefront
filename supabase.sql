-- ============================================================
-- ORIGINALFIT — Base de données Supabase (script final)
-- À coller dans : Supabase Dashboard → SQL Editor → New query → Run
-- Ce script est ré-exécutable sans risque (idempotent).
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABLE : categories (hauts / bas / accessoires)
-- ------------------------------------------------------------
create table if not exists public.categories (
  id          bigint generated always as identity primary key,
  slug        text not null unique,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. TABLE : sizes (XS, S, M, L, XL, Unique)
-- ------------------------------------------------------------
create table if not exists public.sizes (
  id          bigint generated always as identity primary key,
  label       text not null unique,
  sort_order  int  not null default 0
);

-- ------------------------------------------------------------
-- 3. TABLE : products (les styles affichés sur le site)
-- ------------------------------------------------------------
create table if not exists public.products (
  id           bigint generated always as identity primary key,
  name         text not null unique,
  type_label   text not null,                 -- ex : "Haut · visuel d'inspiration"
  category_id  bigint not null references public.categories (id) on delete restrict,
  image_url    text not null,
  tag          text,                          -- ex : "Essentiel", "Layering"
  price        numeric(10,2),                 -- null = "Prix sur demande"
  is_active    boolean not null default true, -- false = masqué du site
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4. TABLE : selections (une demande envoyée par un client)
-- ------------------------------------------------------------
create table if not exists public.selections (
  id           uuid primary key default gen_random_uuid(),
  client_name  text,
  client_city  text,                          -- livraison au Maroc
  instagram    text,                          -- contact du client
  note         text,
  status       text not null default 'nouvelle'
               check (status in ('nouvelle','en_cours','confirmee','livree','annulee')),
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5. TABLE : selection_items (chaque article de la sélection)
-- ------------------------------------------------------------
create table if not exists public.selection_items (
  id           uuid primary key default gen_random_uuid(),
  selection_id uuid not null references public.selections (id) on delete cascade,
  product_id   bigint not null references public.products (id) on delete cascade,
  size_id      bigint references public.sizes (id) on delete set null,
  quantity     int not null default 1 check (quantity > 0),
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 6. INDEX
-- ------------------------------------------------------------
create index if not exists products_category_idx  on public.products (category_id);
create index if not exists products_active_idx    on public.products (is_active);
create index if not exists items_selection_idx    on public.selection_items (selection_id);
create index if not exists items_product_idx      on public.selection_items (product_id);
create index if not exists selections_status_idx  on public.selections (status);
create index if not exists selections_created_idx on public.selections (created_at desc);

-- ------------------------------------------------------------
-- 7. TRIGGER : met à jour updated_at automatiquement
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_updated_at on public.products;
create trigger products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 8. VUE : résumé des demandes (pour toi, dans le dashboard)
-- ------------------------------------------------------------
create or replace view public.v_selections_overview
with (security_invoker = true) as
select
  s.id,
  s.client_name,
  s.client_city,
  s.instagram,
  s.status,
  s.created_at,
  count(i.id)                                    as total_items,
  string_agg(p.name || ' (' || coalesce(sz.label, '-') || ')', ', '
             order by p.name)                     as articles
from public.selections s
left join public.selection_items i on i.selection_id = s.id
left join public.products p        on p.id = i.product_id
left join public.sizes sz          on sz.id = i.size_id
group by s.id;

-- ============================================================
-- 9. RLS (Row Level Security)
-- ============================================================
alter table public.categories      enable row level security;
alter table public.sizes           enable row level security;
alter table public.products        enable row level security;
alter table public.selections      enable row level security;
alter table public.selection_items enable row level security;

-- Lecture publique du catalogue (le site est public)
drop policy if exists "public read categories" on public.categories;
create policy "public read categories"
  on public.categories for select
  to anon, authenticated
  using (true);

drop policy if exists "public read sizes" on public.sizes;
create policy "public read sizes"
  on public.sizes for select
  to anon, authenticated
  using (true);

drop policy if exists "public read products" on public.products;
create policy "public read products"
  on public.products for select
  to anon, authenticated
  using (is_active = true);

-- Les demandes des clients ne sont PAS lisibles publiquement.
-- Seul un utilisateur connecté (toi) peut les consulter / modifier.
drop policy if exists "authenticated read selections" on public.selections;
create policy "authenticated read selections"
  on public.selections for select
  to authenticated
  using (true);

drop policy if exists "authenticated update selections" on public.selections;
create policy "authenticated update selections"
  on public.selections for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated delete selections" on public.selections;
create policy "authenticated delete selections"
  on public.selections for delete
  to authenticated
  using (true);

drop policy if exists "authenticated read items" on public.selection_items;
create policy "authenticated read items"
  on public.selection_items for select
  to authenticated
  using (true);

-- ------------------------------------------------------------
-- 10. GRANTS
-- ------------------------------------------------------------
grant select on public.categories, public.sizes, public.products to anon, authenticated;
grant select, insert, update, delete on public.selections, public.selection_items to authenticated;
revoke insert on public.selections, public.selection_items from anon;

-- ------------------------------------------------------------
-- 11. FONCTION : envoi d'une demande depuis le site
--     (évite d'ouvrir les tables en écriture au public)
-- ------------------------------------------------------------
create or replace function public.creer_demande(
  p_client_name text,
  p_client_city text,
  p_instagram   text,
  p_items       jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_item jsonb;
begin
  if p_client_name is null or length(trim(p_client_name)) = 0 then
    raise exception 'Le prenom est obligatoire';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La selection est vide';
  end if;

  insert into public.selections (client_name, client_city, instagram)
  values (
    trim(p_client_name),
    nullif(trim(coalesce(p_client_city, '')), ''),
    nullif(trim(coalesce(p_instagram, '')), '')
  )
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.selection_items (selection_id, product_id, size_id, quantity)
    values (
      v_id,
      (v_item->>'product_id')::bigint,
      nullif(v_item->>'size_id', '')::bigint,
      greatest(coalesce((v_item->>'quantity')::int, 1), 1)
    );
  end loop;

  return v_id;
end;
$$;

revoke all on function public.creer_demande(text, text, text, jsonb) from public;
grant execute on function public.creer_demande(text, text, text, jsonb) to anon, authenticated;

-- ============================================================
-- 12. SEED : données de départ (identiques au site)
-- ============================================================
insert into public.categories (slug, name, sort_order)
values
  ('haut',         'Hauts',        1),
  ('bas',          'Bas',          2),
  ('accessoires',  'Accessoires',  3)
on conflict (slug) do nothing;

insert into public.sizes (label, sort_order)
values
  ('XS', 1), ('S', 2), ('M', 3), ('L', 4), ('XL', 5), ('Unique', 6)
on conflict (label) do nothing;

insert into public.products (name, type_label, category_id, image_url, tag)
select v.name, v.type_label, c.id, v.image_url, v.tag
from (values
  ('Sneakers sport',   'Chaussures · visuel d''inspiration',  'bas',         'https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&w=900&q=80', 'Style sport'),
  ('T-shirt training', 'Haut · visuel d''inspiration',        'haut',        'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80', 'Essentiel'),
  ('Veste sport',      'Haut · visuel d''inspiration',        'haut',        'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=900&q=80', 'Layering'),
  ('Sac crossbody',    'Accessoire · visuel d''inspiration',  'accessoires', 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=80', 'Accessoire'),
  ('Short training',   'Bas · visuel d''inspiration',         'bas',         'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?auto=format&fit=crop&w=900&q=80', 'Training'),
  ('Hoodie sport',     'Haut · visuel d''inspiration',        'haut',        'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=80', 'Daily fit')
) as v(name, type_label, slug, image_url, tag)
join public.categories c on c.slug = v.slug
on conflict (name) do nothing;

-- ============================================================
-- 13. VÉRIFICATION
-- ============================================================
select 'categories' as table_name, count(*) from public.categories
union all select 'sizes',        count(*) from public.sizes
union all select 'products',     count(*) from public.products
union all select 'demandes',     count(*) from public.selections;

-- ============================================================
-- EXEMPLES D'UTILISATION (à garder pour toi)
-- ============================================================
-- Voir les demandes reçues :
--   select * from public.v_selections_overview order by created_at desc;
-- Changer le statut d'une demande :
--   update public.selections set status = 'confirmee' where id = '...';
-- Ajouter un style :
--   insert into public.products (name, type_label, category_id, image_url, tag)
--   select 'Nouveau modèle', 'Haut · visuel d''inspiration', id,
--          'https://.../image.jpg', 'Nouveau'
--   from public.categories where slug = 'haut';
-- Masquer un style du site :
--   update public.products set is_active = false where name = 'Sneakers sport';
