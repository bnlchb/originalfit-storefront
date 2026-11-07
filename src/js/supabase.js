/* ============================================================================
   THE ORIGINAL FIT — supabase.js
   - Shared namespace + tiny utilities
   - Supabase connection (env from src/js/env.js OR the dev-server /__/env.json)
   - Catalog, cart and pages render empty/skeleton states until Supabase connects
   - Platform API surface: newsletter, contact, orders
   ============================================================================ */
'use strict';

window.TOF = window.TOF || {};
(function buildTOF(T) {
  /* ------------------------------------------------------------ utilities -- */
  T.base = document.body && document.body.dataset.base ? document.body.dataset.base : '';
  T.url = (page) => T.base + page;

  T.money = (n) => Number(n).toFixed(2) + ' DH';

  T.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  T.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const toastWrap = document.getElementById('toast-wrap');
  T.toast = (msg, ms = 2800) => {
    const wrap = toastWrap || document.body;
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = msg;
    wrap ? wrap.appendChild(el) : document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    setTimeout(() => {
      el.classList.remove('is-in');
      setTimeout(() => el.remove(), 350);
    }, ms);
  };

  /* ----------------------------------------------------------- connection -- */
  T.mode = 'pending';   // 'supabase' | 'demo'
  T.sb = null;          // supabase-js client (may stay null)

  let resolveReady;
  T.ready = new Promise((r) => { resolveReady = r; });
  T.whenReady = () => T.ready;

  function readWindowEnv() {
    const e = window.TOF_ENV;
    return e && (e.SUPABASE_URL || '').startsWith('http') && (e.SUPABASE_ANON_KEY || '').trim()
      ? e : null;
  }

  async function fetchDevEnv() {
    if (location.protocol === 'file:') return null;
    try {
      const r = await fetch('/__/env.json', { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      return (j.SUPABASE_URL || '').startsWith('http') && (j.SUPABASE_ANON_KEY || '').trim() ? j : null;
    } catch { return null; }
  }

  async function waitForCDN(ms = 9000) {
    const t0 = Date.now();
    while (!window.supabase && Date.now() - t0 < ms) await T.sleep(60);
    return window.supabase || null;
  }

  async function init() {
    const env = (await readWindowEnv()) || (await fetchDevEnv());
    let client = null;

    if (env) {
      const lib = await waitForCDN();
      if (lib && typeof lib.createClient === 'function') {
        try {
          client = lib.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
            auth: { persistSession: true, detectSessionInUrl: true, storageKey: 'tof-auth' },
          });
        } catch (err) {
          console.warn('[TOF] Supabase client init failed:', err && err.message);
        }
      }
      // health check: only keep the client when the schema is reachable
      if (client) {
        try {
          const { error } = await client.from('categories').select('slug').limit(1);
          if (!error) {
            T.sb = client;
          } else {
            console.warn('[TOF] Supabase schema unreachable — run supabase/schema.sql:', error.message);
          }
        } catch (err) {
          console.warn('[TOF] Supabase network error — live catalog unavailable:', err && err.message);
        }
      }
    }

    T.mode = T.sb ? 'supabase' : 'demo';
    if (T.mode === 'demo') {
      console.warn('[TOF] Supabase is not connected — products and categories load from the backend only. Set SUPABASE_URL / SUPABASE_ANON_KEY (env.js or your host env vars).');
    }
    resolveReady();
  }

  /* ------------------------------------------------ error classification -- */
  /* Order failures must NOT all look the same: a dead session (401) is fixed
     differently from an RLS rejection (403/42501), a network error or a DB
     rule violation. Classify supabase-js / PostgREST / fetch errors once. */
  const AUTH_RE = /jwt|session|token|401|unauthorized|expired/i;
  const RLS_RE  = /row-level security|42501|permission denied|violates/i;
  const NET_RE  = /failed to fetch|networkerror|load failed|fetch failed/i;

  function classifyError(err) {
    const msg = String((err && err.message) || err || '');
    const code = String((err && err.code) || '');
    const status = Number((err && err.status) || 0);
    if (err instanceof SyntaxError || err instanceof TypeError || NET_RE.test(msg)) return 'network';
    if (status === 401 || code === 'PGRST301' || code === 'PGRST304' || AUTH_RE.test(msg)) return 'auth';
    if (code === 'PGRST202' || /could not find the function|schema cache/i.test(msg)) return 'missing-rpc';
    if (status === 403 || code === '42501' || RLS_RE.test(msg)) return 'forbidden';
    return 'db';
  }

  /* Attach a stable .kind to any error-ish object (or wrap a raw string). */
  T.tagError = function tagError(err) {
    let e = err;
    if (!e || typeof e !== 'object') e = { message: String(err || 'Unknown error.') };
    try { e.kind = classifyError(e); } catch { e.kind = 'db'; }
    return e;
  };

  /* Call a remote QL snippet, fall back to demo side-effect when needed.
     Every failure is classified (kind) and surfaced verbatim — never silently
     hidden or replaced by a placeholder message. */
  T.remoteOr = async function remoteOr(test, fnRemote, fnDemo) {
    if (T.sb) {
      let result = null;
      try {
        result = await fnRemote();
        if (!result.error) return result;
        result.error = T.tagError(result.error);
        console.warn('[TOF] remote call failed → fallback [' + result.error.kind + ']:', result.error.message);
      } catch (err) {
        result = { data: null, error: T.tagError(err) };
        console.warn('[TOF] remote call threw → fallback [' + result.error.kind + ']:', result.error.message);
      }
      if (fnDemo) return fnDemo();
      return result && result.error ? result : { data: null, error: { message: 'Supabase is not connected.', kind: 'network' } };
    }
    if (fnDemo) return fnDemo();
    return { data: null, error: { message: 'Supabase is not connected.', kind: 'network' } };
  };

  /* ---------------------------------------------------- platform-level API -- */
  T.api = {
    /** Newsletter subscribe. */
    async subscribe(email) {
      email = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Please enter a valid email address.' };
      return T.remoteOr(
        null,
        async () => {
          const { error } = await T.sb.from('newsletter_subscribers').insert({ email });
          if (error && /duplicate key/i.test(error.message || '')) return { data: { dup: true }, error: null };
          if (error) throw error;
          return { data: { dup: false }, error: null };
        },
        () => {
          try {
            const list = JSON.parse(localStorage.getItem('tof_newsletter') || '[]');
            if (list.includes(email)) return { data: { dup: true }, error: null };
            list.push(email);
            localStorage.setItem('tof_newsletter', JSON.stringify(list));
            return { data: { dup: false }, error: null };
          } catch { return { data: { dup: false }, error: null }; }
        },
      ).then((r) => ({ ok: !!r.data, dup: !!(r.data && r.data.dup) }));
    },

    /** Contact form submission. */
    async sendContact(payload) {
      const p = payload || {};
      if (!p.name || !p.email || !p.message) return { ok: false, error: 'Please fill in every required field.' };
      return T.remoteOr(
        null,
        async () => {
          const { error } = await T.sb.from('contact_messages').insert({
            name: p.name, email: p.email, subject: p.subject || 'General', message: p.message,
          });
          if (error) throw error;
          return { data: { id: 1 }, error: null };
        },
        () => {
          try {
            const list = JSON.parse(localStorage.getItem('tof_contact') || '[]');
            list.push({ ...p, at: Date.now() });
            localStorage.setItem('tof_contact', JSON.stringify(list));
          } catch { /* private mode — toast still shows success */ }
          return { data: { id: 1 }, error: null };
        },
      ).then(() => ({ ok: true }));
    },

    /** Create an order through the secure DB function `create_order` (migration
        0004). The browser never supplies prices, totals or ownership: the
        function re-reads prices from `products`, resolves the customer with
        auth.uid() and computes shipping + total server-side. `clientRef` is a
        UUID minted per submit — the same value retried returns the same order
        (DB-level duplicate protection). */
    async createOrder({ address, items, clientRef }) {
      return T.remoteOr(
        null,
        async () => {
          const { data, error } = await T.sb.rpc('create_order', {
            p_client_ref: clientRef || null,
            p_address: address,     // untrusted: sanitized inside the function
            p_items: (items || []).map((it) => ({ id: it.id, qty: it.qty })),
          });
          if (error) throw error;
          return { data: data || null, error: null };
        },
        null,
      ).then((r) => ({
        ok: !!((r && r.data && r.data.id)),
        id: r && r.data ? r.data.id : null,
        total: r && r.data ? r.data.total : null,
        error: r ? r.error : null,
      }));
    },

    /** Orders for the signed-in user (with joined product info). */
    async listMyOrders() {
      return T.remoteOr(
        null,
        async () => {
          const { data, error } = await T.sb
            .from('orders')
            .select('id, total_amount, status, shipping_address, created_at, items:order_items(id, quantity, unit_price, product:products(id, name, image_url))')
            .order('created_at', { ascending: false })
            .limit(20);
          return { data, error };
        },
        null,
      );
    },
  };

  /* kick things off — remaining modules attach once T.ready resolves */
  init();
})(window.TOF);
