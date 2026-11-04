/* ============================================================================
   THE ORIGINAL FIX — wishlist.js
   Wishlist with local persistence; syncs to Supabase `wishlists` when signed in.
   ============================================================================ */
'use strict';

window.TOF = window.TOF || {};

(function wishlistModule(T) {
  const KEY = 'tof_wishlist_v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* private mode */ }
  }

  let ids = load().map(Number);
  let userId = null; // set by auth.js

  function emit() {
    document.dispatchEvent(new CustomEvent('tof:wishlist'));
  }

  function has(id) {
    return ids.includes(Number(id));
  }

  function paintLocally(id) {
    document.querySelectorAll(`[data-wish="${id}"]`).forEach((btn) => {
      const on = has(id);
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on);
      btn.setAttribute('aria-label', (on ? 'Remove from' : 'Add to') + ' wishlist');
    });
  }

  async function remoteToggle(p) {
    if (!T.sb || !userId) return true; // local mode is always "successful"
    try {
      if (has(p)) {
        const { error } = await T.sb.from('wishlists').delete()
          .match({ user_id: userId, product_id: p });
        if (error) throw error;
      } else {
        const { error } = await T.sb.from('wishlists').upsert({ user_id: userId, product_id: p }, { ignoreDuplicates: true });
        if (error) throw error;
      }
    } catch (err) {
      console.warn('[TOF] wishlist sync failed:', err && err.message);
      return false;
    }
    return true;
  }

  async function toggle(id) {
    const pid = Number(id);
    if (!pid) return null;
    const willAdd = !has(pid);
    if (willAdd) ids.push(pid); else ids = ids.filter((n) => n !== pid);
    save();
    paintLocally(pid);
    emit();

    remoteToggle(pid).then((ok) => {
      if (!ok) {
        // revert view state? keep local; user is informed
        T.toast('Wishlist will sync when you are signed in.');
      }
    });
    return willAdd ? 'added' : 'removed';
  }

  /** Called on sign-in: merge local wishlist into the account, then mirror rows back. */
  async function syncOnLogin(newUserId) {
    if (!T.sb || !newUserId) return;
    userId = newUserId;
    try {
      const { data, error } = await T.sb.from('wishlists').select('product_id').match({ user_id: newUserId });
      const remoteIds = (error ? [] : (data || []).map((r) => Number(r.product_id))).filter(Boolean);
      // merge (upsert local additions)
      const toPull = ids.filter((n) => !remoteIds.includes(n));
      if (toPull.length) {
        await T.sb.from('wishlists')
          .upsert(toPull.map((pid) => ({ user_id: newUserId, product_id: pid })), { ignoreDuplicates: true });
      }
      // final state: remote ∪ local
      ids = Array.from(new Set([...remoteIds, ...ids]));
      save();
      emit();
    } catch (err) {
      console.warn('[TOF] wishlist merge failed:', err && err.message);
    }
  }

  /** Hydrated wishlist rows (join product data from the catalog). */
  async function hydrated() {
    await T.products.loadOnce();
    const out = [];
    for (const id of ids) {
      const p = await T.products.get(id);
      if (p) out.push(p);
    }
    return out;
  }

  T.wishlist = { has, toggle, syncOnLogin, hydrated, count: () => ids.length, setUserId: (id) => { userId = Number(id) || (id || null); } };
})(window.TOF);
