# THE ORIGINAL FIT — Premium Streetwear E-Commerce

A complete, production-ready storefront built with **HTML5 + CSS3 + Vanilla JavaScript** and a
**Supabase** backend (database, authentication, storage). Minimalist black / white / grey
design system with premium motion design.

> **Wear Your Style.** — Premium T-Shirts. Timeless Design. Made for the ones who stand out.

---

## 1. Quick start

No packages, no build step — only Node.js ≥ 18 (dev server & env tooling)

```bash
npm run dev
# ➜ http://localhost:5173
```

Open the site in your browser. Products, categories and orders are served live from Supabase —
with no backend connected the grids keep their skeleton/empty states instead of demo data.

### Going live with Supabase (2 minutes)

1. Create a project on [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   This creates all tables, RLS policies, auth triggers, storage buckets **and the collection seed**
   (3 collections). The product catalog starts **empty** — add your real products from the
   admin console afterwards, so the site serves backend data only.
   > The script starts by dropping the legacy tables from the previous Originalfit storefront
   > (`products`, `categories`, `selections`, `selection_items`, `sizes`). Keep that block in
   > unless you still need those tables.
3. Copy your **Project URL** and **anon / publishable key** into `.env`
   (already pre-filled if you reuse the previous Supabase project):
   ```
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   ```
4. `npm run dev` again. The health check picks up the schema automatically and the site
   switches to live data. Register an account, add to cart, place an order.

### Environment variables

- `.env` — the only place real values exist locally, **git-ignored** (never commit).
- `.env.example` — template for new clones.
- **No credential is hard-coded anywhere in the source.** The values reach the browser
  without ever being committed:
  - **Dev:** the built-in server serves them at `GET /__/env.json` straight from `.env`.
  - **Static hosting by hand (Netlify/S3/…):** `npm run env:sync` generates the git-ignored
    `src/js/env.js` from `.env`, which ships with your build.
  - **CI (the included GitHub Actions workflow):** add `SUPABASE_URL` / `SUPABASE_ANON_KEY`
    as repository *secrets* (Settings → Secrets and variables → Actions); the workflow
    regenerates `src/js/env.js` at build time. The `.env` file itself never reaches the
    repository or the deploy artifact.
- Only the public anon key is ever sent to the browser — data security comes from
  Row Level Security.

---

## 2. Project structure

```
the-original-fit/
├── index.html                 ← home (hero, New Arrival, sale banner, collections)
├── package.json               ← scripts only, zero dependencies
├── .env / .env.example        ← Supabase credentials (git-ignored / template)
├── .gitignore
│
├── pages/
│   ├── shop.html              ← catalog with filters + sorting + live search query
│   ├── product.html           ← product detail (id → ?id=), sizes, qty, wishlist
│   ├── collections.html       ← Streetwear / Minimalist / Hoodies
│   ├── about.html             ← story, values, stats, policies
│   ├── contact.html           ← contact form (→ contact_messages) + FAQ
│   ├── login.html             ← sign in / create account (Supabase Auth)
│   ├── cart.html              ← full cart, summary, address form, order placement
│   └── account.html           ← profile, orders, wishlist (protected)
│
├── src/
│   ├── css/
│   │   ├── style.css          ← design system & all component styles
│   │   ├── responsive.css     ← tablet / mobile breakpoints
│   │   └── animations.css     ← reveals, hero entrance, skeletons, keyframes
│   ├── js/
│   │   ├── supabase.js        ← connection, env loading, platform APIs (orders/newsletter/contact)
│   │   ├── products.js        ← catalog layer + card rendering
│   │   ├── cart.js            ← cart store (localStorage), cart page, checkout
│   │   ├── wishlist.js        ← wishlist (localStorage + Supabase sync)
│   │   ├── auth.js            ← auth + login page + account page logic
│   │   ├── search.js          ← live search overlay
│   │   └── main.js            ← UI orchestration (header, drawer, reveals, hero…)
│   └── assets/icons/          ← favicon & inline icon set
│
├── supabase/
│   ├── schema.sql             ← tables + RLS + triggers + storage + collection seed
│   └── migrations/            ← forward-only SQL changes for existing installs
│
└── scripts/
    ├── dev-server.mjs         ← zero-dependency static server (serves /__/env.json)
    └── sync-env.mjs           ← generates src/js/env.js for static hosting
```

---

## 3. Features

| Area | Details |
| --- | --- |
| Home | Announcement bar, transparent→solid sticky nav, 3-slide hero with EST. 2024 rail & scroll cue, New Arrival (live), 50% OFF promo banner, Our Collections |
| Shop | Category chips, On-Sale filter, sorting (best sellers / newest / price / name), keyword search, result count, skeletons, empty state |
| Product | Zoom-on-hover media, size selector, quantity stepper, wishlist heart, stock state, related products, accordions |
| Cart | Sliding drawer + full page, size chips per line, qty · −/+, remove, free-shipping progress over 500 DH, persisted between sessions (localStorage) |
| Checkout | Auth-gated order wrapper → address form → order + order_items written to Supabase; guest cart keeps working |
| Accounts | Supabase email/password auth, auto-created `profiles` row (trigger), profile editing, order history, wishlist |
| Wishlist | Heart on cards & PDP, persists locally, syncs/merges with `wishlists` when signed in |
| Search | Live results overlay with thumbnails, Enter → shop?q=… |
| Newsletter | Footer + contact form → `newsletter_subscribers` (dedup-safe) |
| Contact | Validated form → `contact_messages`, success state, FAQ (track order / shipping / returns / fit) |
| Motion | Scroll reveals, hero cascade, image zooms, button arrow slides, drawer easing, skeleton shimmer, badge cart “bump” — all honoring `prefers-reduced-motion` |
| Responsive | Desktop / laptop / tablet / mobile — hamburger menu, 2-col product grid, no horizontal overflow |

---

## 4. Database (RLS summary)

- `products`, `categories` — public **read** (anon + authenticated), writes via service role only
- `profiles`, `orders`, `order_items`, `wishlists` — owner-only via `auth.uid() = user_id`
- `newsletter_subscribers`, `contact_messages` — public **insert**, read never exposed to anon
- Storage buckets `product-images` & `collection-images` — public read, autenticated write

The **service_role key must never appear in frontend code** — all admin product management
happens through the Supabase dashboard (or a future admin tool with the server-side key).

---

## 5. Static deployment

```bash
# Deploying by hand (Netlify / S3 / …):
npm run env:sync    # writes git-ignored src/js/env.js from .env
# deploy the whole folder to your static host (index.html at root)

# Deploying the included GitHub Actions workflow: no .env in CI needed —
# add SUPABASE_URL and SUPABASE_ANON_KEY as repository secrets and push.
# The workflow regenerates src/js/env.js from secrets at build time.
```

---

## 6. Notes

- Images point at hosted editorial fashion photography; to use your own, upload files to the
  `product-images` bucket and swap the `image_url` values in the `products` table — or manage
  everything from the admin console (section 7).

---

## 7. Admin console

Manage the full site from `pages/admin.html` (products, categories, orders, contact
messages, newsletter subscribers) — no dashboard digging required.

1. **Enable admin rights** (once): run [`supabase/migrations/0002_admin_console_rls.sql`](supabase/migrations/0002_admin_console_rls.sql) in the
   Supabase SQL Editor — after `schema.sql` (for existing installs: after migration 0001). It is
   idempotent and only adds an `is_admin` flag plus admin policies. RLS still protects every table;
   the browser keeps using the publishable key only.
2. **Create the admin user**: Supabase Dashboard → Authentication → Users → **Add user**
   → *Create new user* (enable **Auto Confirm User**), then promote it:
   ```sql
   update public.profiles set is_admin = true where email = 'admin@example.com';
   ```
3. **Sign in**: open `pages/admin.html` (e.g. `http://localhost:5173/pages/admin.html`)
   and use that email + password. The console opens only for accounts whose
   `profiles.is_admin` is true.

Admin capabilities: add/edit/hide/delete products (image URL or upload to the
`product-images` bucket), manage categories, view all orders and move their status
along `pending → paid → shipped → delivered / cancelled`, read/delete contact
messages, manage the newsletter list. Ordered items keep their line even if the
product is deleted (`on delete set null`).
