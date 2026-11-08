-- ============================================================================
-- 0007_admin_login_aggressive_ladder.sql
-- THE ORIGINAL FIT — migrations/0007
--
-- Upserts 0006's throttle into an AGGRESSIVE PER-ATTEMPT ladder: every failed
-- admin sign-in advances the lock level immediately (no 5-attempt threshold):
--   1st fail → 1 min | 2nd → 5 min | 3rd → 20 min | (4th→5 min, 5th→10 min,
--   6th→20 min were non-increasing in the request → clamped to ≥ previous,
--   i.e. 20/20/20) | 7th → 30 min | 8th → 1 h | 9th → 2 h | 10th → 6 h |
--   11th → 12 h | 12th and beyond → 24 h
-- * Lock expiry does NOT reset the counter (the next failure jumps to the
--   next level). Only a SUCCESSFUL sign-in wipes the identifier's ledger.
-- * HH:MM:SS countdown rendered by the client from server retry_after.
-- * All counters/timestamps live in admin_login_attempts (RLS ON, zero
--   policies — server-only); password never stored; refresh/new tabs/browser
--   cannot bypass (server state is keyed to identifier + client IP).
-- * Supabase Auth and every existing RLS policy are untouched.
-- Standalone: safe to paste whether or not 0006 ran before (if-not-exists).
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

  -- best-effort client ip: x-forwarded-for as forwarded to PostgREST
  begin
    v_addr := split_part(
      coalesce(nullif(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''),
               inet_client_addr()::text), ',', 1);
  exception when others then
    v_addr := null;
  end;
  v_ip := coalesce(left(btrim(coalesce(v_addr, 'unknown')), 64), 'unknown');

  -- ledger horizon: the ladder must survive multi-hour locks (24h+), so the
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

  -- spray guard (unchanged from 0006): ≥20 failures from one IP in 10 min,
  -- regardless of identifier → ≤10-min cooldown; report the LONGER wait
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

-- VERIFY ---------------------------------------------------------------------
--   select * from public.admin_login_lock('u@x.test', null);   -- unlocked, fails 0
--   select ip from public.admin_login_attempts;                -- anon → denied (no policies)
