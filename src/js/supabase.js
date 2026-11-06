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

  /* Call a remote QL snippet, fall back to demo side-effect when needed. */
  T.remoteOr = async function remoteOr(test, fnRemote, fnDemo) {
    if (T.sb) {
      try {
        const result = await fnRemote();
        if (!result.error) return result;
        console.warn('[TOF] remote call failed → fallback:', result.error && result.error.message);
      } catch (err) {
        console.warn('[TOF] remote call threw → fallback:', err && err.message);
      }
    }
    if (fnDemo) return fnDemo();
    return { data: null, error: { message: 'Supabase is not connected.' } };
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

    /** Create an order (authenticated users only). Returns the new order id. */
    async createOrder({ userId, total, address, items }) {
      return T.remoteOr(
        null,
        async () => {
          const { data: orderRow, error: e1 } = await T.sb
            .from('orders')
            .insert({ user_id: userId, total_amount: total, shipping_address: address })
            .select('id')
            .single();
          if (e1) throw e1;
          const rows = items.map((it) => ({
            order_id: orderRow.id,
            product_id: it.id,
            quantity: it.qty,
            unit_price: it.price,
          }));
          const { error: e2 } = await T.sb.from('order_items').insert(rows);
          if (e2) throw e2;
          return { data: orderRow, error: null };
        },
        null,
      ).then((r) => ({ ok: !!(r && r.data), id: r && r.data ? r.data.id : null, error: r ? r.error : null }));
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
