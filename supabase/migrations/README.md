# Database migrations

Forward-only SQL for an **already-created** Supabase schema (`supabase/schema.sql`
is the one-shot, full-install script for new projects — never re-run it on a
database that has data).

## Convention

| Rule | Why |
| --- | --- |
| Filename `NNNN_<short_description>.sql`, applied in **ascending** numeric order | Order is the versioning |
| Each file changes **one thing** and is idempotent (re-running it is a no-op or clearly intentional) | Safe to re-paste after a retry |
| Never edit or re-run a migration that is already applied — add `NNNN+1` instead | Databases drift; versioning must not |
| Keep the `VERIFY` snippet at the bottom | Instant visual confirmation |

## How to apply

1. Supabase **Dashboard → SQL Editor** → paste the file's full contents → **Run**.
   (SQL Editor executes with service-role privileges, bypassing RLS — exactly
   what migrations need.)

## Applied so far

| # | File | Purpose |
| --- | --- | --- |
| 0001 | `0001_remove_demo_seed_products.sql` | Deletes the 10 placeholder seed products (catalog → live rows only) |
| 0002 | `0002_admin_console_rls.sql` | `profiles.is_admin` + `is_admin()` helper + admin console policies |
| 0003 | `0003_guest_checkout.sql` | Guest checkout: anon inserts for null-user orders + items |
| 0004 | `0004_secure_order_creation.sql` | All order creation moves behind a security-definer `create_order()` — server re-prices from `products`, no more anon/authenticated direct INSERT policies, `client_ref` idempotency |
| 0005 | `0005_fix_create_order_null_total.sql` | Fixes 23502 (total_amount NULL) from 0004: PL/pgSQL `SELECT…INTO` with no rows nulls the accumulators — re-init on miss + hardened concurrent-submit fallback |

## Changing the schema later

Prefer adding a `NNNN_*` file over rerunning `schema.sql`. If the change also
belongs in a fresh install, mirror the same change inside `supabase/schema.sql`.
