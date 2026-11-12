/* ============================================================================
   THE ORIGINAL FIT — cart.js
   Local cart (persists between sessions) + cart page rendering + checkout.
   ============================================================================ */
'use strict';

window.TOF = window.TOF || {};

(function cartModule(T) {
  const KEY = 'tof_cart_v1';
  const FREE_SHIPPING_AT = 500;   // DH — free shipping threshold
  const STANDARD_SHIPPING = 30;   // DH — flat shipping below the threshold

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { return []; }
  }

  let items = load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode */ }
  }

  function emit() {
    document.dispatchEvent(new CustomEvent('tof:cart'));
  }

  const keyOf = (id, size) => `${id}:${size}`;

  /* Canonical size ladder (0009) — shown in drawer + cart page. */
  const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

  /* How many of `size` can still be added for a product line with the given
     per-size snapshot (item.sizes captured at add time and refreshed on every
     catalog prune). Legacy products without size rows have no per-size cap —
     the server (create_order) still enforces the product-level stock. */
  const capFor = (snapshot, size) => {
    if (!Array.isArray(snapshot) || !snapshot.length) return 99;
    const row = snapshot.find((x) => x.size === size) || {};
    return Math.max(0, Number(row.stock) || 0);
  };

  /* ------------------------------------------------------------------ API -- */
  function add(product, size = 'M', qty = 1) {
    const want = Math.max(1, Math.min(Number(qty) || 1, 99));
    const snap = Array.isArray(product.sizes) ? product.sizes : null;
    const cap = capFor(snap, size);
    const k = keyOf(product.id, size);
    const existing = items.find((it) => it.key === k);
    const current = existing ? existing.qty : 0;
    if (cap <= current) return 'blocked';
    const finalQty = current + Math.min(want, cap - current);

    if (existing) {
      existing.qty = finalQty;
    } else {
      items.push({
        key: k,
        id: product.id,
        name: product.name,
        price: Number(product.price),
        imageUrl: product.imageUrl,
        size,
        qty: finalQty,
        sizes: snap, // per-size snapshot for cart-side availability
      });
    }
    save(); emit();
    return current + want <= cap ? 'added' : 'clamped';
  }

  function setQty(key, qty) {
    const it = items.find((i) => i.key === key);
    if (!it) return;
    const cap = capFor(it.sizes, it.size);
    const max = Math.max(1, Math.min(cap, 99)); // cap 0 → hold at 1; server rejects at checkout
    it.qty = Math.max(1, Math.min(Number(qty) || 1, max));
    save(); emit();
  }

  function setSize(key, size) {
    const it = items.find((i) => i.key === key);
    if (!it || it.size === size) return;
    const merged = items.find((o) => o.key === keyOf(it.id, size));
    /* availability comes from whichever line carries the freshest snapshot */
    const snap = Array.isArray(merged && merged.sizes) && (merged.sizes || []).length
      ? merged.sizes
      : (Array.isArray(it.sizes) && it.sizes.length ? it.sizes : null);
    const cap = capFor(snap, size);
    const combined = (merged ? merged.qty : 0) + it.qty;
    if (cap <= 0) return 'blocked';
    const finalQty = Math.min(combined, Math.max(1, cap));
    if (merged) {
      merged.qty = finalQty;
      items = items.filter((i) => i.key !== key);
    } else {
      it.key = keyOf(it.id, size);
      it.size = size;
      it.qty = finalQty;
    }
    save(); emit();
    return finalQty < combined ? 'clamped' : 'added';
  }

  function remove(key) {
    items = items.filter((i) => i.key !== key);
    save(); emit();
  }

  function clear() {
    items = [];
    save(); emit();
  }

  const read = () => items.slice();
  const count = () => items.reduce((s, i) => s + i.qty, 0);
  const subtotal = () => items.reduce((s, i) => s + i.price * i.qty, 0);
  const shipping = (sub = subtotal()) => (sub > 0 && sub < FREE_SHIPPING_AT ? STANDARD_SHIPPING : 0);
  const total = (sub = subtotal()) => sub; // order total == items total (shipping note shown separately)
  const freeShippingAt = () => FREE_SHIPPING_AT;

  /* ------------------------------------------------------------ cart PAGE -- */
  async function initCartPage() {
    const listEl = document.getElementById('cart-list');
    if (!listEl) return; // not on cart page

    renderPage();

    document.getElementById('checkout-btn')?.addEventListener('click', startCheckout);

    document.addEventListener('tof:cart', renderPage);
  }

  function renderPage() {
    const listEl = document.getElementById('cart-list');
    const emptyEl = document.getElementById('cart-empty');
    const gridEl = document.getElementById('cart-page-grid');
    const successEl = document.getElementById('order-success');
    if (!listEl) return;

    const sub = subtotal();
    ship = shipping(sub);

    listEl.innerHTML = items.map(itemHTML).join('');
    if (emptyEl) emptyEl.hidden = items.length > 0;
    if (gridEl) gridEl.style.display = items.length ? '' : 'none';

    const fmt = (n) => T.money(n);
    document.getElementById('sum-subtotal').textContent = fmt(sub);
    const shipRowPhone = document.getElementById('sum-shipping');
    if (shipRowPhone) shipRowPhone.textContent = ship === 0 ? 'Free' : fmt(ship);
    document.getElementById('sum-total').textContent = fmt(sub + ship);
    const checkoutBtn = document.getElementById('checkout-btn');
    if (checkoutBtn) {
      checkoutBtn.disabled = items.length === 0;
      checkoutBtn.textContent = sub > 0 && sub < FREE_SHIPPING_AT
        ? 'Checkout'
        : 'Checkout';
    }
    document.getElementById('free-note').textContent =
      items.length === 0 ? '' :
      sub >= FREE_SHIPPING_AT ? 'Free shipping unlocked.' :
      `Add ${fmt(FREE_SHIPPING_AT - sub)} more for free shipping.`;
  }

  function itemHTML(it) {
    const snap = Array.isArray(it.sizes) && it.sizes.length ? it.sizes : null;
    const chipFor = (s) => {
      const row = snap && (snap.find((x) => x.size === s) || {});
      const out = snap ? ((row.stock || 0) <= 0) : false;
      return `<button type="button" class="chip${s === it.size ? ' is-on' : ''}${out ? ' is-out' : ''}" aria-pressed="${s === it.size}"${out ? ' disabled title="Out of stock"' : ''} data-size="${s}">${s}</button>`;
    };
    return `
      <div class="cart-item" data-key="${it.key}">
        <img src="${it.imageUrl}" alt="${T.esc(it.name)}">
        <div class="ci-info">
          <h4 class="ci-name"><a href="${T.url('product.html?id=' + encodeURIComponent(it.id))}">${T.esc(it.name)}</a></h4>
          <div class="ci-size-chips" data-key="${it.key}">
            ${SIZES.map(chipFor).join('')}
          </div>
          <div class="ci-qty">
            <button type="button" data-step="-1" aria-label="Decrease quantity">−</button>
            <span>${it.qty}</span>
            <button type="button" data-step="1" aria-label="Increase quantity">+</button>
          </div>
        </div>
        <div class="ci-side">
          <span class="ci-price">${T.money(it.price * it.qty)}</span>
          <button type="button" class="ci-remove" data-remove="${it.key}">Remove</button>
        </div>
      </div>`;
  }

  /* size chips live in both drawer + page (SIZES declared above) */
  let ship = 0;

  function cartItemDelegation(container, { withSize = true } = {}) {
    container.addEventListener('click', (e) => {
      const key = e.target.closest('[data-key]')?.dataset.key;
      const stepBtn = e.target.closest('[data-step]');
      if (stepBtn && key) {
        const it = items.find((i) => i.key === key);
        if (it) setQty(key, it.qty + Number(stepBtn.dataset.step));
        return;
      }
      const rmBtn = e.target.closest('[data-remove]');
      if (rmBtn) { remove(rmBtn.dataset.remove); return; }
      if (withSize) {
        const sizeBtn = e.target.closest('[data-size]');
        if (sizeBtn && key) {
          const res = setSize(key, sizeBtn.dataset.size);
          if (res === 'blocked') T.toast(`Size ${sizeBtn.dataset.size} is out of stock.`);
          else if (res === 'clamped') T.toast('Limited stock in that size — quantity adjusted.');
        }
      }
    });
  }
  T.cartPageDelegation = cartItemDelegation; // reused by main.js for the drawer

  /* ------------------------------------------------------------- checkout -- */
  /* One random UUID per submission: the DB dedupes double-clicks/retries on it
     (orders.client_ref, migration 0004). A new token is minted on each submit. */
  function newClientRef() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;   // uuid v4 bits
    b[8] = (b[8] & 0x3f) | 0x80;   // variant bits
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  async function startCheckout() {
    if (!items.length) return;
    const user = await T.auth.ready().then(() => T.auth.user());
    const gate = document.getElementById('checkout-gate');
    const addressForm = document.getElementById('address-form');
    const successEl = document.getElementById('order-success');
    const loginGate = document.getElementById('login-gate');

    gate?.setAttribute('hidden', '');
    if (loginGate) loginGate.hidden = !!user; // guests keep an optional sign-in hint
    addressForm?.removeAttribute('hidden');
    addressForm?.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (!addressForm) return;

    addressForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(addressForm));
      const missing = ['full_name', 'address', 'city', 'zip'].some((k) => !String(data[k] || '').trim());
      if (missing) { T.toast('Please complete the shipping address.'); return; }

      const btn = addressForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Placing order…';

      /* The server (create_order RPC) treats everything here as untrusted:
         it re-prices every line from `products`, resolves the customer via
         auth.uid(), validates this address and computes the total itself.
         clientRef stays the same across a retry — the DB returns the SAME
         order instead of writing a duplicate. */
      const clientRef = newClientRef();
      const addr = {
        full_name: data.full_name, phone: data.phone || '', email: data.email || '',
        address: data.address, city: data.city, zip: data.zip, country: data.country || 'Morocco',
      };

      let res = await T.api.createOrder({ address: addr, items, clientRef });
      let orderedAsGuest = !user;

      /* If the stored sign-in session was expired when the customer pressed
         submit, the first attempt dies with a 401/JWT error. Clear the dead
         session FIRST — otherwise the retry sends the same expired
         Authorization header and fails identically — then retry ONCE as a
         guest order, same clientRef. */
      if (!res.ok && user && res.error && res.error.kind === 'auth') {
        console.warn('[TOF] sign-in session expired mid-checkout — retrying as guest.');
        try { await T.sb.auth.signOut(); } catch { /* session already dead */ }
        try { localStorage.removeItem('tof-auth'); } catch { /* private mode */ }
        res = await T.api.createOrder({ address: addr, items, clientRef });
        orderedAsGuest = res.ok;
      }

      if (!res.ok) {
        btn.disabled = false;
        btn.textContent = 'Place Order';
        T.toast(res.error && res.error.kind === 'missing-rpc'
          ? 'Order system not ready — the store database still needs migration 0004 (Supabase → SQL Editor).'
          : 'Could not place the order — ' + ((res.error && res.error.message) || 'please try again.'));
        return;
      }

      // success — the cart is cleared ONLY here, after the order exists
      document.getElementById('cart-main').hidden = true;
      successEl.hidden = false;
      successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById('success-id').textContent = 'Order #' + String(res.id).slice(0, 8).toUpperCase();
      const note = document.getElementById('success-note');
      if (note) note.textContent = orderedAsGuest
        ? 'You ordered as a guest — keep your order number handy, we will contact you to confirm the details.'
        : 'We sent a confirmation email and you can follow the progress under My Account → Orders.';
      const ordersLink = document.getElementById('success-orders-link');
      if (ordersLink) ordersLink.hidden = orderedAsGuest;
      clear();
      btn.disabled = false;
      btn.textContent = 'Place Order';
    }, { once: true });
  }

  /* ------------------------------------------------ catalog validation -- */
  /* Cart lines capture name/price/image at add-time. If a product is deleted
     or deactivated in the backend, the line becomes a ghost: it renders from
     the snapshot and fails checkout with an FK error. Re-resolve against the
     live catalog once when the page boots: drop anything not in it, refresh
     the per-size snapshot and clamp quantities to current size stock. */
  async function pruneAgainstCatalog() {
    try {
      await T.whenReady();
      if (T.mode !== 'supabase' || !T.products) return; // backend down → never nuke the local cart
      const live = await T.products.list({});
      const byId = new Map(live.map((p) => [Number(p.id), p]));
      const known = [];
      let dropped = 0;
      let dirty = false;
      for (const it of items) {
        const p = byId.get(Number(it.id));
        if (!p) { dropped++; dirty = true; continue; }
        if (Array.isArray(p.sizes) && p.sizes.length) {
          it.sizes = p.sizes; // refresh availability snapshot
          dirty = true;
          const cap = capFor(it.sizes, it.size);
          if (cap <= 0) { dropped++; continue; } // this size is no longer available
          const clamped = Math.max(1, Math.min(it.qty, cap));
          if (clamped !== it.qty) dirty = true;
          it.qty = clamped;
        }
        known.push(it);
      }
      if (!dirty) return;
      items = known;
      if (dropped) T.toast(`${dropped} item${dropped === 1 ? '' : 's'} no longer available — removed from your cart.`);
      save(); emit();
    } catch { /* best-effort; the cart keeps working locally */ }
  }
  pruneAgainstCatalog();

  T.cart = {
    add, setQty, setSize, remove, clear, read, count, subtotal, shipping, total, freeShippingAt,
    initCartPage, itemHTML, SIZES,
    SHIPPING: STANDARD_SHIPPING,
  };
})(window.TOF);
