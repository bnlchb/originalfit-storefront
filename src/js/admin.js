/* ============================================================================
   THE ORIGINAL FIT — admin.js
   Admin console (pages/admin.html): sign-in gate + management of
   products, categories, orders, contact messages and newsletter subscribers.
   Rights are enforced server-side by RLS (profiles.is_admin → supabase/migrations/0002).
   ============================================================================ */
'use strict';

window.TOF = window.TOF || {};

(function adminModule(T) {
  const qs  = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];

  const S = {
    console: false,
    user: null,          // auth user
    products: [],        // all rows (incl inactive — needs admin policy)
    categories: [],
    orders: [],          // enriched: { ...o, items, customer }
    messages: [],
    subs: [],
    prodFilter: '',
    orderFilter: '',
    activeTab: 'products',
    uploadedFile: null,  // File for the product form
  };

  /* ------------------------------------------------------------ helpers -- */
  function fmtDT(iso) {
    try {
      return new Date(iso).toLocaleString('en-US',
        { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch { return '—'; }
  }

  function slugify(text) {
    return String(text || '').toLowerCase().trim()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function img(url) {
    return url && /^(https?:|data:)/.test(url) ? url : '';
  }

  /* Uniform db error → human message */
  function dbMsg(res, fallback) {
    if (!res.error) return null;
    const m = res.error.message || '';
    console.warn('[TOF admin]', m);
    if (/row.level|permission/i.test(m)) {
      return 'Server refused — run supabase/migrations/0002_admin_console_rls.sql and promote this account (is_admin = true).';
    }
    if (/foreign key/i.test(m)) {
      return 'Still referenced elsewhere — move or delete the related rows first.';
    }
    if (/unique/i.test(m)) return 'That value already exists (duplicate slug or email).';
    return m || fallback || 'Database error.';
  }

  /* --------------------------------------------------------------- gate -- */
  function show(el) {
    ['admin-loading', 'admin-gate', 'admin-denied', 'admin-demo', 'admin-console']
      .forEach((id) => { const n = document.getElementById(id); if (n) n.hidden = true; });
    if (el) el.hidden = false;
  }

  async function gate() {
    S.user = T.auth.user();
    if (!S.user) { show(document.getElementById('admin-gate')); return; }

    const res = await T.sb.from('profiles')
      .select('is_admin, full_name, email')
      .eq('id', S.user.id)
      .maybeSingle();

    if (res.error) {
      console.warn('[TOF admin] profile read failed:', res.error.message);
      show(document.getElementById('admin-denied'));
      const msg = document.getElementById('denied-msg');
      msg.textContent = 'Could not verify your account (' + res.error.message + ').'
        + (res.error.message.indexOf('is_admin') !== -1
          ? ' Run supabase/migrations/0002_admin_console_rls.sql first — it adds the is_admin column.'
          : '');
      return;
    }

    const isAdmin = !!(res.data && res.data.is_admin);
    if (!isAdmin) {
      const denied = document.getElementById('denied-msg');
      const who = (res.data && (res.data.full_name || res.data.email)) || S.user.email || 'this user';
      denied.textContent = 'Signed in as ‘' + who + '’ — this account has no admin rights.';
      show(document.getElementById('admin-denied'));
      return;
    }

    bootConsole();
  }

  function wireGate() {
    const loginLink = document.getElementById('gate-login-link');
    if (loginLink) loginLink.href = T.url('login.html?next=' + encodeURIComponent('admin.html'));

    // show / hide password (eye button)
    const pwWrap = document.querySelector('#gate-form .pw-wrap');
    if (pwWrap) {
      const input = pwWrap.querySelector('input');
      const toggle = pwWrap.querySelector('.pw-toggle');
      if (input && toggle) {
        toggle.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.6"/></svg>';
        toggle.addEventListener('click', () => {
          const show = input.type === 'password';
          input.type = show ? 'text' : 'password';
          toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        });
      }
    }

    const form = document.getElementById('gate-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('gate-submit');
      const err = document.getElementById('gate-error');
      const email = document.getElementById('gate-email').value.trim();
      const pw = document.getElementById('gate-pw').value;
      err.hidden = true;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Signing in…';
      const res = await T.auth.signIn(email, pw);
      btn.disabled = false;
      btn.textContent = 'Enter Admin Console';
      if (!res.ok) {
        err.textContent = res.error || 'Sign-in failed.';
        err.hidden = false;
        return;
      }
      T.toast('Welcome back.');
      await gate();
    });

    document.getElementById('denied-recheck').addEventListener('click', () => gate());
    document.getElementById('denied-signout').addEventListener('click', async () => {
      await T.auth.signOut();
      show(document.getElementById('admin-gate'));
      const err = document.getElementById('gate-error');
      if (err) { err.hidden = true; }
    });
  }

  /* ------------------------------------------------------------ console -- */
  function bootConsole() {
    S.console = true;
    show(document.getElementById('admin-console'));
    const who = document.getElementById('admin-who');
    who.textContent = 'Signed in as ' + (S.user.email || 'admin')
      + ' — rights enforced by Row Level Security (is_admin).';
    const chip = document.getElementById('header-chip');
    if (chip) chip.hidden = false;

    document.getElementById('admin-signout').addEventListener('click', async () => {
      S.console = false;
      await T.auth.signOut();
      show(document.getElementById('admin-gate'));
      const err = document.getElementById('gate-error'); if (err) err.hidden = true;
    });
    document.getElementById('admin-refresh').addEventListener('click', () => loadAll().then(paintTab));

    wireTabs();
    wireProducts();
    wireCategories();
    wireOrders();
    wireMessages();

    loadAll().then(() => { paintStats(); paintTab(); });

    document.addEventListener('tof:auth', () => {
      if (S.console) return;     // console stays until sign-out above
      gate();
    });
  }

  function wireTabs() {
    qsa('#admin-tabs .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.activeTab = btn.dataset.tab;
        qsa('#admin-tabs .tab-btn').forEach((b) => b.classList.toggle('is-on', b === btn));
        qsa('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== S.activeTab; });
        paintTab();
      });
    });
  }

  function paintTab() {
    qsa('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== S.activeTab; });
    if (S.activeTab === 'products') paintProducts();
    if (S.activeTab === 'categories') paintCategories();
    if (S.activeTab === 'orders') paintOrders();
    if (S.activeTab === 'messages') paintMessages();
    if (S.activeTab === 'subs') paintSubs();
  }

  /* ------------------------------------------------------------- loading -- */
  let loadAllSeq = 0;
  async function loadAll() {
    const seq = ++loadAllSeq;
    const rows = (res) => { const m = dbMsg(res, 'Could not load data.'); if (m) T.toast(m); return res.data || []; };

    const [prod, cats, orders, items, profiles, names, msgs, subs] = await Promise.all([
      T.sb.from('products').select('*').order('created_at', { ascending: false }),
      T.sb.from('categories').select('*').order('created_at', { ascending: true }),
      T.sb.from('orders').select('*').order('created_at', { ascending: false }).limit(300),
      T.sb.from('order_items').select('*').limit(1000),
      T.sb.from('profiles').select('id, full_name, email').limit(1000),
      T.sb.from('products').select('id, name'),
      T.sb.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(300),
      T.sb.from('newsletter_subscribers').select('*').order('created_at', { ascending: false }).limit(2000),
    ]);

    if (seq !== loadAllSeq) return; // superseded

    S.products = rows(prod);
    S.categories = rows(cats);
    S.messages = rows(msgs);
    S.subs = rows(subs);

    const profMap = {};
    rows(profiles).forEach((p) => { profMap[p.id] = p; });
    const nameMap = {};
    rows(names).forEach((n) => { nameMap[n.id] = n.name; });

    const itemsByOrder = {};
    rows(items).forEach((it) => {
      (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push({
        ...it,
        name: nameMap[it.product_id] || 'Item',
      });
    });
    S.orders = rows(orders).map((o) => ({
      ...o,
      items: (itemsByOrder[o.id] || []),
      customer: (o.user_id && profMap[o.user_id]) || null,
    }));

    paintStats();
  }

  function paintStats() {
    const box = document.getElementById('admin-stats');
    if (!box) return;
    box.querySelector('[data-stat="products"]').textContent = String(S.products.length);
    box.querySelector('[data-stat="pending"]').textContent = String(S.orders.filter((o) => o.status === 'pending').length);
    box.querySelector('[data-stat="messages"]').textContent = String(S.messages.length);
    box.querySelector('[data-stat="subs"]').textContent = String(S.subs.length);
  }

  /* ----------------------------------------------------------- products -- */
  function wireProducts() {
    const form = document.getElementById('prod-form');
    document.getElementById('prod-new').addEventListener('click', () => openProductForm(null));

    document.getElementById('prod-cancel').addEventListener('click', () => { form.hidden = true; });

    document.getElementById('prod-search').addEventListener('input', (e) => {
      S.prodFilter = e.target.value.trim().toLowerCase();
      paintProducts();
    });

    document.getElementById('prod-img-file').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      S.uploadedFile = file || null;
      const prev = document.getElementById('prod-preview');
      if (file) {
        prev.src = URL.createObjectURL(file);
        prev.hidden = false;
        T.toast(`Image “${file.name}” ready — it uploads when you save.`);
      } else {
        prev.hidden = true;
      }
    });

    form.addEventListener('submit', (e) => { e.preventDefault(); saveProduct(); });

    document.getElementById('prod-rows').addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) { openProductForm(Number(edit.dataset.edit)); return; }

      const toggle = e.target.closest('[data-toggle]');
      if (toggle) {
        const id = Number(toggle.dataset.toggle);
        const p = S.products.find((x) => x.id === id);
        if (!p) return;
        toggle.disabled = true;
        const res = await T.sb.from('products')
          .update({ is_active: !p.is_active }).eq('id', id);
        toggle.disabled = false;
        const m = dbMsg(res);
        if (m) { T.toast(m); return; }
        p.is_active = !p.is_active;
        paintProducts();
        T.toast(p.is_active ? 'Product visible in shop.' : 'Product hidden from shop.');
        return;
      }

      const del = e.target.closest('[data-del]');
      if (del) {
        const id = Number(del.dataset.del);
        const p = S.products.find((x) => x.id === id);
        if (!p || !confirm(`Delete “${p.name}” permanently? Order history items will keep their line.`)) return;
        del.disabled = true;
        const res = await T.sb.from('products').delete().eq('id', id);
        del.disabled = false;
        const m = dbMsg(res);
        if (m) { T.toast(m); return; }
        S.products = S.products.filter((x) => x.id !== id);
        paintStats(); paintProducts();
        T.toast('Product deleted.');
      }
    });
  }

  function openProductForm(id) {
    const form = document.getElementById('prod-form');
    const p = id ? S.products.find((x) => x.id === id) : null;
    document.getElementById('prod-form-title').textContent = p ? 'Edit product' : 'Add product';
    document.getElementById('prod-id').value = p ? p.id : '';
    document.getElementById('prod-name').value = p ? p.name : '';
    fillCategoryOptions(document.getElementById('prod-cat'), p ? p.category_id : null);
    document.getElementById('prod-price').value = p ? num(p.price) : '';
    document.getElementById('prod-orig').value = p && p.original_price ? num(p.original_price) : '';
    document.getElementById('prod-stock').value = p ? p.stock : '';
    document.getElementById('prod-img').value = p ? (p.image_url || '') : '';
    document.getElementById('prod-desc').value = p ? (p.description || '') : '';
    document.getElementById('prod-newflag').checked = p ? !!p.is_new : false;
    document.getElementById('prod-best').checked = p ? !!p.is_best_seller : false;
    document.getElementById('prod-active').checked = p ? !!p.is_active : true;

    S.uploadedFile = null;
    const file = document.getElementById('prod-img-file');
    file.value = '';
    const prev = document.getElementById('prod-preview');
    const url = p ? img(p.image_url) : '';
    if (url) { prev.src = url; prev.hidden = false; } else { prev.hidden = true; }

    form.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('prod-name').focus();
  }

  function fillCategoryOptions(sel, selectedId) {
    sel.innerHTML = S.categories.map((c) =>
      `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>${T.esc(c.name)}</option>`).join('')
      || '<option value="">— add a category first —</option>';
  }

  async function saveProduct() {
    const saveBtn = document.getElementById('prod-save');
    const name = document.getElementById('prod-name').value.trim();
    const category_id = Number(document.getElementById('prod-cat').value) || null;
    const price = num(document.getElementById('prod-price').value, NaN);
    if (!name || !category_id || !Number.isFinite(price)) {
      T.toast('Name, category and a valid price are required.');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner"></span> Saving…';
    try {
      let image_url = document.getElementById('prod-img').value.trim();

      // upload chosen file (admin-only via storage RLS)
      if (S.uploadedFile) {
        const f = S.uploadedFile;
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = `admin/${Date.now()}-${slugify(name).slice(0, 60) || 'product'}.${ext}`;
        const up = await T.sb.storage.from('product-images').upload(path, f, {
          contentType: f.type || 'image/jpeg',
                                          cacheControl: '3600',
                                          upsert: false,
        });
        const m = dbMsg(up, 'Image upload failed.');
        if (m) { T.toast(m); throw new Error('upload'); }
        image_url = T.sb.storage.from('product-images').getPublicUrl(path).data.publicUrl;
      }

      const originalRaw = document.getElementById('prod-orig').value;
      const payload = {
        name,
        description: document.getElementById('prod-desc').value.trim(),
        price: Math.round(price * 100) / 100,
        original_price: originalRaw === '' ? null : Math.round(num(originalRaw) * 100) / 100,
        image_url: image_url || '',
        category_id,
        stock: Math.max(0, Math.trunc(num(document.getElementById('prod-stock').value))),
        is_new: document.getElementById('prod-newflag').checked,
        is_best_seller: document.getElementById('prod-best').checked,
        is_active: document.getElementById('prod-active').checked,
      };

      const id = document.getElementById('prod-id').value;
      const res = id
        ? await T.sb.from('products').update(payload).eq('id', Number(id))
        : await T.sb.from('products').insert(payload);

      const m = dbMsg(res, 'Could not save the product.');
      if (m) { T.toast(m); throw new Error('db'); }

      T.toast(id ? 'Product updated.' : 'Product added to the shop.');
      document.getElementById('prod-form').hidden = true;
      S.uploadedFile = null;
      await loadAll();
      paintTab();
    } catch { /* toast already shown */ }
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save product';
  }

  function paintProducts() {
    const tb = document.getElementById('prod-rows');
    const list = S.products.filter((p) =>
      !S.prodFilter || (p.name || '').toLowerCase().includes(S.prodFilter)
        || (p.description || '').toLowerCase().includes(S.prodFilter));

    if (!S.categories.length) {
      tb.innerHTML = '<tr><td colspan="7"><p class="admin-note-inline">Create at least one category first.</p></td></tr>';
      return;
    }
    if (!list.length) {
      tb.innerHTML = '<tr><td colspan="7"><p class="admin-note-inline">'
        + (S.products.length ? 'No match for “' + T.esc(S.prodFilter) + '”.' : 'No products yet — click “＋ New product”.')
        + '</p></td></tr>';
      return;
    }

    const catName = (id) => {
      const c = S.categories.find((x) => x.id === id);
      return c ? c.name : '—';
    };

    tb.innerHTML = list.map((p) => `
      <tr>
        <td>${img(p.image_url)
          ? `<img class="thumb" src="${img(p.image_url)}" alt="${T.esc(p.name)}">`
          : '<span class="thumb thumb-empty"></span>'}</td>
        <td>
          <div class="cell-strong">${T.esc(p.name)}</div>
          <div class="cell-muted">${p.is_new ? 'NEW ' : ''}${p.is_best_seller ? 'BEST ' : ''}${T.esc(String(p.description || '')).slice(0, 64)}</div>
        </td>
        <td>${T.esc(catName(p.category_id))}</td>
        <td>${T.money(num(p.price))}${p.original_price ? `<br><s>${T.money(num(p.original_price))}</s>` : ''}</td>
        <td>${p.stock}</td>
        <td><span class="status-pill ${p.is_active ? 'paid' : 'cancelled'}">${p.is_active ? 'live' : 'hidden'}</span></td>
        <td class="td-actions">
          <button class="x-btn" type="button" data-toggle="${p.id}">${p.is_active ? 'Hide' : 'Show'}</button>
          <button class="x-btn" type="button" data-edit="${p.id}">Edit</button>
          <button class="x-btn is-danger" type="button" data-del="${p.id}">Delete</button>
        </td>
      </tr>`).join('');
  }

  /* -------------------------------------------------------- categories -- */
  function wireCategories() {
    const form = document.getElementById('cat-form');
    document.getElementById('cat-new').addEventListener('click', () => openCategoryForm(null));
    document.getElementById('cat-cancel').addEventListener('click', () => { form.hidden = true; });

    document.getElementById('cat-name').addEventListener('input', (e) => {
      const slug = document.getElementById('cat-slug');
      if (slug.dataset.touched) return;
      slug.value = slugify(e.target.value);
    });
    document.getElementById('cat-slug').addEventListener('input', () => {
      document.getElementById('cat-slug').dataset.touched = '1';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = form.querySelector('button[type="submit"]');
      const name = document.getElementById('cat-name').value.trim();
      const slug = (document.getElementById('cat-slug').value.trim() || slugify(name)).toLowerCase();
      if (!name || !slug) { T.toast('Name and slug are required.'); return; }

      saveBtn.disabled = true;
      const payload = {
        name, slug,
        image_url: document.getElementById('cat-img').value.trim() || null,
        description: document.getElementById('cat-desc').value.trim() || null,
      };
      const id = document.getElementById('cat-id').value;
      const res = id
        ? await T.sb.from('categories').update(payload).eq('id', Number(id))
        : await T.sb.from('categories').insert(payload);
      saveBtn.disabled = false;
      const m = dbMsg(res, 'Could not save the category.');
      if (m) { T.toast(m); return; }
      T.toast(id ? 'Category updated.' : 'Category created.');
      form.hidden = true;
      await loadAll();
      paintTab();
    });

    document.getElementById('cat-list').addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) { openCategoryForm(Number(edit.dataset.edit)); return; }
      const del = e.target.closest('[data-del]');
      if (del) {
        const id = Number(del.dataset.del);
        const c = S.categories.find((x) => x.id === id);
        if (!c || !confirm(`Delete category “${c.name}”?`)) return;
        del.disabled = true;
        const res = await T.sb.from('categories').delete().eq('id', id);
        del.disabled = false;
        const m = dbMsg(res);   // foreign key guard explains products still attached
        if (m) { T.toast(m); return; }
        T.toast('Category deleted.');
        await loadAll();
        paintTab();
      }
    });
  }

  function openCategoryForm(id) {
    const form = document.getElementById('cat-form');
    const c = id ? S.categories.find((x) => x.id === id) : null;
    document.getElementById('cat-form-title').textContent = c ? 'Edit category' : 'Add category';
    document.getElementById('cat-id').value = c ? c.id : '';
    document.getElementById('cat-name').value = c ? c.name : '';
    const slug = document.getElementById('cat-slug');
    slug.value = c ? c.slug : '';
    slug.dataset.touched = c ? '1' : '';
    document.getElementById('cat-img').value = c ? (c.image_url || '') : '';
    document.getElementById('cat-desc').value = c ? (c.description || '') : '';
    form.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('cat-name').focus();
  }

  function paintCategories() {
    const grid = document.getElementById('cat-list');
    if (!S.categories.length) {
      grid.innerHTML = '<p class="admin-note-inline">No categories yet — click “＋ New category”.</p>';
      return;
    }
    grid.innerHTML = S.categories.map((c) => {
      const count = S.products.filter((p) => p.category_id === c.id).length;
      return `
      <div class="panel-card cat-card">
        ${img(c.image_url) ? `<img class="cat-img" src="${img(c.image_url)}" alt="${T.esc(c.name)}">` : ''}
        <h3>${T.esc(c.name)}</h3>
        <p class="cell-muted">/${T.esc(c.slug)} — ${count} product${count === 1 ? '' : 's'}</p>
        <p class="cat-desc">${T.esc(c.description || '')}</p>
        <div class="btn-row">
          <button class="x-btn" type="button" data-edit="${c.id}">Edit</button>
          <button class="x-btn is-danger" type="button" data-del="${c.id}">Delete</button>
        </div>
      </div>`;
    }).join('');
  }

  /* -------------------------------------------------------------- orders -- */
  function wireOrders() {
    document.getElementById('order-filter').addEventListener('change', (e) => {
      S.orderFilter = e.target.value;
      paintOrders();
    });
    document.getElementById('orders-list').addEventListener('change', async (e) => {
      const sel = e.target.closest('select[data-order]');
      if (!sel) return;
      const id = sel.dataset.order;
      const status = sel.value;
      if (id) {
        const btn = sel;
        btn.disabled = true;
        const res = await T.sb.from('orders').update({ status }).eq('id', id);
        btn.disabled = false;
        const m = dbMsg(res, 'Status update failed.');
        if (m) { T.toast(m); paintOrders(); return; }
        const o = S.orders.find((x) => x.id === id);
        if (o) o.status = status;
        T.toast(`Order #${id.slice(0, 8).toUpperCase()} → ${status}.`);
        paintStats();
      }
    });
  }

  function paintOrders() {
    const box = document.getElementById('orders-list');
    const list = S.orders.filter((o) => !S.orderFilter || o.status === S.orderFilter);
    if (!list.length) {
      box.innerHTML = `<p class="admin-note-inline">${S.orders.length ? 'No orders in this status.' : 'No orders yet — they appear here when customers check out.'}</p>`;
      return;
    }

    // total items per order row
    const total = (o) => o.total_amount != null ? T.money(num(o.total_amount)) : T.money(
      o.items.reduce((s, it) => s + num(it.unit_price) * it.quantity, 0));

    box.innerHTML = list.map((o) => `
      <div class="panel-card order-admin">
        <div class="order-top">
          <span class="oid">#${String(o.id || '').slice(0, 8).toUpperCase()}</span>
          <span class="oid">${fmtDT(o.created_at)}</span>
          <span class="oid">${T.esc(
            (o.customer && (o.customer.full_name || o.customer.email))
            || (o.shipping_address && (o.shipping_address.full_name || o.shipping_address.email))
            || 'guest customer')}</span>
        </div>
        <ul class="order-items">
          ${o.items.length
            ? o.items.map((it) => `
              <li><span>${it.quantity} × ${T.esc(it.name)}</span><span>${T.money(num(it.unit_price) * it.quantity)}</span></li>`).join('')
            : '<li><span>No items</span><span>—</span></li>'}
        </ul>
        ${addrText(o.shipping_address) ? `<p class="oa-addr">📍 ${T.esc(addrText(o.shipping_address))}</p>` : ''}
        <div class="order-total"><span>Total</span><span>${total(o)}</span></div>
        <div class="oa-status">
          <label for="order-sel-${String(o.id).slice(0, 8).toLowerCase()}">Status</label>
          <select class="admin-search" id="order-sel-${String(o.id).slice(0, 8).toLowerCase()}" data-order="${o.id}">
            ${STATUSES.map((s) => `<option value="${s}"${s === o.status ? ' selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>`).join('');
  }

  function addrText(sa) {
    if (!sa || typeof sa !== 'object') return '';
    const keys = ['full_name', 'name', 'phone', 'email', 'address', 'line1', 'line2', 'city', 'state', 'zip', 'postal_code', 'country', 'notes'];
    const vals = keys
      .map((k) => sa[k])
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .filter(Boolean);
    return vals.join(' · ') || (Object.keys(sa).length ? JSON.stringify(sa) : '');
  }

  /* ------------------------------------------------------------ messages -- */
  function wireMessages() {
    document.getElementById('msg-list').addEventListener('click', async (e) => {
      const del = e.target.closest('[data-del]');
      if (!del) return;
      const id = del.dataset.del;
      if (!confirm('Delete this message?')) return;
      del.disabled = true;
      const res = await T.sb.from('contact_messages').delete().eq('id', id);
      del.disabled = false;
      const m = dbMsg(res, 'Delete failed.');
      if (m) { T.toast(m); return; }
      S.messages = S.messages.filter((x) => x.id !== id);
      paintStats(); paintMessages();
      T.toast('Message deleted.');
    });
  }

  function paintMessages() {
    const box = document.getElementById('msg-list');
    if (!S.messages.length) {
      box.innerHTML = '<p class="admin-note-inline">No messages yet.</p>';
      return;
    }
    box.innerHTML = S.messages.map((msg) => `
      <div class="panel-card msg-card">
        <div class="order-top">
          <span class="oid">${T.esc(msg.subject || 'General')}</span>
          <span class="oid">${fmtDT(msg.created_at)}</span>
          <span class="oid">${T.esc(msg.name)} · ${T.esc(msg.email)}</span>
        </div>
        <p class="msg-body">${T.esc(msg.message)}</p>
        <div class="btn-row">
          <a class="x-btn" href="mailto:${T.esc(msg.email)}?subject=Re:%20${T.esc(msg.subject || 'Message')}">Reply</a>
          <button class="x-btn is-danger" type="button" data-del="${msg.id}">Delete</button>
        </div>
      </div>`).join('');
  }

  /* ---------------------------------------------------------- subscribers -- */
  function wireSubs() {
    document.getElementById('sub-rows').addEventListener('click', async (e) => {
      const del = e.target.closest('[data-del]');
      if (!del) return;
      const id = del.dataset.del;
      if (!confirm('Remove this subscriber?')) return;
      del.disabled = true;
      const res = await T.sb.from('newsletter_subscribers').delete().eq('id', id);
      del.disabled = false;
      const m = dbMsg(res, 'Delete failed.');
      if (m) { T.toast(m); return; }
      S.subs = S.subs.filter((x) => x.id !== id);
      paintStats(); paintSubs();
      T.toast('Subscriber removed.');
    });

    document.getElementById('subs-copy').addEventListener('click', async () => {
      const emails = S.subs.map((s) => s.email).join('\n');
      try { await navigator.clipboard.writeText(emails); T.toast(`${S.subs.length} emails copied.`); }
      catch { T.toast('Clipboard blocked — export manually from the SQL editor.'); }
    });
  }

  function paintSubs() {
    const tb = document.getElementById('sub-rows');
    if (!S.subs.length) {
      tb.innerHTML = '<tr><td colspan="3"><p class="admin-note-inline">No subscribers yet.</p></td></tr>';
      return;
    }
    tb.innerHTML = S.subs.map((s) => `
      <tr>
        <td class="cell-strong">${T.esc(s.email)}</td>
        <td class="cell-muted">${fmtDT(s.created_at)}</td>
        <td class="td-actions"><button class="x-btn is-danger" type="button" data-del="${s.id}">Remove</button></td>
      </tr>`).join('');
  }

  /* ---------------------------------------------------------------- boot -- */
  T.whenReady().then(() => {
    if (!T.sb) {
      show(document.getElementById('admin-demo'));
      return;
    }
    wireGate();
    wireSubs();

    T.auth.ready().then(() => gate());
    // late auth changes while still gated (e.g. sign-in done from login page)
    document.addEventListener('tof:auth', () => { if (!S.console) gate(); });
  });
})(window.TOF);