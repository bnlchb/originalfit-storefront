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

  /* ------------------------------------------------------------------ API -- */
  function add(product, size = 'M', qty = 1) {
    const k = keyOf(product.id, size);
    const existing = items.find((it) => it.key === k);
    if (existing) {
      existing.qty = Math.min(existing.qty + qty, 99);
      save(); emit();
      return 'increased';
    }
    items.push({
      key: k,
      id: product.id,
      name: product.name,
      price: Number(product.price),
      imageUrl: product.imageUrl,
      size,
      qty: Math.max(1, Math.min(Number(qty) || 1, 99)),
    });
    save(); emit();
    return 'added';
  }

  function setQty(key, qty) {
    const it = items.find((i) => i.key === key);
    if (!it) return;
    it.qty = Math.max(1, Math.min(Number(qty) || 1, 99));
    save(); emit();
  }

  function setSize(key, size) {
    const it = items.find((i) => i.key === key);
    if (!it || it.size === size) return;
    const merged = items.find((o) => o.key === keyOf(it.id, size));
    if (merged) {
      merged.qty = Math.min(merged.qty + it.qty, 99);
      items = items.filter((i) => i.key !== key);
    } else {
      it.key = keyOf(it.id, size);
      it.size = size;
    }
    save(); emit();
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
    return `
      <div class="cart-item" data-key="${it.key}">
        <img src="${it.imageUrl}" alt="${T.esc(it.name)}">
        <div class="ci-info">
          <h4 class="ci-name"><a href="${T.url('product.html?id=' + encodeURIComponent(it.id))}">${T.esc(it.name)}</a></h4>
          <div class="ci-size-chips" data-key="${it.key}">
            ${SIZES.map((s) => `<button type="button" class="chip${s === it.size ? ' is-on' : ''}" data-size="${s}">${s}</button>`).join('')}
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

  /* size chips live in both drawer + page */
  const SIZES = ['S', 'M', 'L', 'XL'];
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
        if (sizeBtn && key) setSize(key, sizeBtn.dataset.size);
      }
    });
  }
  T.cartPageDelegation = cartItemDelegation; // reused by main.js for the drawer

  /* ------------------------------------------------------------- checkout -- */
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

      const shippingCost = shipping();
      const res = await T.api.createOrder({
        userId: user ? user.id : null,
        total: subtotal() + shippingCost,
        address: {
          full_name: data.full_name, phone: data.phone || '', email: data.email || '',
          address: data.address, city: data.city, zip: data.zip, country: data.country || 'Morocco',
        },
        items,
      });

      if (!res.ok) {
        btn.disabled = false;
        btn.textContent = 'Place Order';
        T.toast('Could not place the order — ' + ((res.error && res.error.message) || 'try again.'));
        return;
      }

      // success
      document.getElementById('cart-main').hidden = true;
      successEl.hidden = false;
      successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById('success-id').textContent = 'Order #' + String(res.id).slice(0, 8).toUpperCase();
      const note = document.getElementById('success-note');
      if (note) note.textContent = user
        ? 'We sent a confirmation email and you can follow the progress under My Account → Orders.'
        : 'You ordered as a guest — keep your order number handy, we will contact you to confirm the details.';
      const ordersLink = document.getElementById('success-orders-link');
      if (ordersLink) ordersLink.hidden = !user;
      clear();
      btn.disabled = false;
      btn.textContent = 'Place Order';
    }, { once: true });
  }

  /* ------------------------------------------------ catalog validation -- */
  /* Cart lines capture name/price/image at add-time. If a product is deleted
     or deactivated in the backend, the line becomes a ghost: it renders from
     the snapshot and fails checkout with an FK error. Re-resolve against the
     live catalog once when the page boots and drop anything not in it. */
  async function pruneAgainstCatalog() {
    try {
      await T.whenReady();
      if (T.mode !== 'supabase' || !T.products) return; // backend down → never nuke the local cart
      const live = await T.products.list({});
      const valid = new Set(live.map((p) => Number(p.id)));
      const known = items.filter((it) => valid.has(Number(it.id)));
      if (known.length === items.length) return;
      const dropped = items.length - known.length;
      items = known;
      save(); emit();
      T.toast(`${dropped} item${dropped === 1 ? '' : 's'} no longer available — removed from your cart.`);
    } catch { /* best-effort; the cart keeps working locally */ }
  }
  pruneAgainstCatalog();

  T.cart = {
    add, setQty, setSize, remove, clear, read, count, subtotal, shipping, total, freeShippingAt,
    initCartPage, itemHTML, SIZES,
    SHIPPING: STANDARD_SHIPPING,
  };
})(window.TOF);
