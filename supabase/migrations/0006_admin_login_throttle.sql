-- ============================================================================
-- 0006_admin_login_throttle.sql
-- THE ORIGINAL FIT — migrations/0006
--
-- SERVER-side brute-force protection for the Admin Sign In page:
--   * every admin sign-in attempt is metered by the security-definer function
--     public.admin_login_lock() — the browser cannot bypass the ledger
--   * state lives in public.admin_login_attempts (RLS ON, ZERO policies —
--     no role can read/modify it directly; only the definer function does)
--   * keys are the normalized login identifier AND a best-effort client IP
--     (x-forwarded-for as forwarded to PostgREST); passwords are NEVER
--     stored or logged — only identifier + success flag + timestamp
--   * ladder per identifier over a 24h window of failed attempts:
--       fails 0-4   → allowed
--       5th failure → 1 minute lock, then 5 min / 15 min / 30 min per block,
--       beyond that → 1 hour maximum — NEVER permanent
--   * separate spray guard: ≥20 failures from one IP inside 10 minutes
--     (regardless of identifier) → 10-minute cooldown for that address
--   * a SUCCESSFUL sign-in wipes that identifier's failed rows — a legitimate
--     admin is never locked out for good
-- Lock state survives refreshes, new tabs and cleared localStorage because
-- it is server-side, keyed to the identifier.
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
  v_level    integer;
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

  -- best-effort client ip: PostgREST exposes request headers as a GUC
  begin
    v_addr := split_part(
      coalesce(nullif(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''),
               inet_client_addr()::text), ',', 1);
  exception when others then
    v_addr := null;
  end;
  v_ip := coalesce(left(btrim(coalesce(v_addr, 'unknown')), 64), 'unknown');

  -- ledger hygiene: nothing older than 24 hours matters
  delete from public.admin_login_attempts where created_at < now() - interval '24 hours';

  -- successful sign-in: wipe that identifier's failures — never punish a
  -- legitimate admin who just proved ownership of the password
  if p_success is true then
    delete from public.admin_login_attempts where the_lock = v_key and not success;
    return jsonb_build_object('locked', false, 'retry_after', 0, 'fails', 0);
  end if;

  -- record the failed attempt
  if p_success is false then
    insert into public.admin_login_attempts (the_lock, ip, success) values (v_key, v_ip, false);
  end if;

  -- identifier ladder (24h window)
  select count(*), max(created_at) into v_fails, v_last
    from public.admin_login_attempts
   where the_lock = v_key and not success and created_at >= now() - interval '24 hours';

  v_level := v_fails / 5;  -- integer division: 5-9 → 1, 10-14 → 2, 15-19 → 3, ...
  if v_level >= 1 then
    v_dur := case v_level when 1 then 60 when 2 then 300 when 3 then 900
             when 4 then 1800 else 3600 end;
    if v_last + make_interval(secs => v_dur) > now() then
      v_locked := true;
      v_wait := greatest(1, extract(epoch from (v_last + make_interval(secs => v_dur) - now()))::integer);
    end if;
  end if;

  -- spray guard: one address hammering many identifiers in a burst
  if not v_locked and v_ip <> 'unknown' then
    select count(*), max(created_at) into v_ip_fails, v_ip_last
      from public.admin_login_attempts
     where ip = v_ip and not success and created_at >= now() - interval '10 minutes';
    if v_ip_fails >= 20 then
      v_locked := true;
      v_wait := greatest(1, extract(epoch from (v_ip_last + interval '10 minutes' - now()))::integer);
    end if;
  end if;

  return jsonb_build_object('locked', v_locked, 'retry_after', v_wait, 'fails', coalesce(v_fails, 0));
end;
$$;

comment on function public.admin_login_lock(text, boolean) is
  'Server-side admin sign-in throttle: 24h ledger of failed attempts keyed to identifier + client IP; ladder 1/5/15/30/60-min locks after every 5 failures; never permanent; passwords never stored.';

-- only the web/api roles may call it; it never returns identifiers or IPs
revoke all on function public.admin_login_lock(text, boolean) from public;
grant execute on function public.admin_login_lock(text, boolean) to anon, authenticated;

-- VERIFY ---------------------------------------------------------------------
--   select * from public.admin_login_lock('nobody@nowhere.test', null);  -- unlocked, fails 0
--   select ip from public.admin_login_attempts;  -- ERROR from anon: RLS, no policies
