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
    sizeRows: [],       // product_sizes rows (0009) — empty until migration runs
    prodFilter: '',
    orderFilter: '',
    activeTab: 'products',
    prodPhotos: [],     // [{url, name}] — uploaded photos for the product form
    prodCover: 0,       // index of the cover photo within prodPhotos
    prodSaving: false,  // re-entry lock — one save in flight at a time
  };
  const MAX_PHOTOS = 10;

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
      return 'Server refused this operation — your session may have expired. Sign in again.';
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
      document.getElementById('denied-msg').textContent = 'Could not verify your access right now. Please try again in a moment.';
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

  /* ------------------------------------------------- admin sign-in gate -- */
  /* Throttle state is SERVER-side (admin_login_attempts, migration 0006):
     refreshed pages, second tabs and cleared localStorage cannot bypass it —
     every submit re-checks the live server state before touching Supabase Auth. */
  let lockTimer = null;

  /** Server ledger call: p_success null → status only, true → success (wipe),
      false → record a failed attempt. Returns {locked, retry_after, fails}. */
  async function gateLock(email, success) {
    if (!T.sb) return null;
    try {
      const { data, error } = await T.sb.rpc('admin_login_lock', { p_login: email, p_success: success });
      if (error) { console.warn('[TOF admin] throttle:', error.message); return null; }
      return data || null;
    } catch { console.warn('[TOF admin] throttle unreachable'); return null; }
  }

  /** Show the lockout message with a live countdown; disable "Enter Admin
      Console"; automatically re-enable when the server-declared wait ends. */
  function applyLock(state) {
    const btn = document.getElementById('gate-submit');
    const err = document.getElementById('gate-error');
    const lockEl = document.getElementById('gate-lock');
    err.hidden = true;
    if (lockTimer) { clearInterval(lockTimer); lockTimer = null; }
    let left = Math.max(1, Number(state.retry_after) || 1);

    const paint = () => {
      const hh = String(Math.floor(left / 3600)).padStart(2, '0');
      const mm = String(Math.floor((left % 3600) / 60)).padStart(2, '0');
      const ss = String(left % 60).padStart(2, '0');
      lockEl.textContent = 'Too many failed login attempts. Please try again in ' + hh + ':' + mm + ':' + ss + '.';
      lockEl.hidden = false;
    };
    paint();

    btn.disabled = true;
    btn.textContent = 'Locked';

    lockTimer = setInterval(() => {
      left -= 1;
      if (left > 0) { paint(); return; }
      clearInterval(lockTimer); lockTimer = null;
      lockEl.hidden = true;
      btn.disabled = false;
      btn.textContent = 'Enter Admin Console';
    }, 1000);
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
      if (!email || !pw) { err.textContent = 'Please fill in both fields.'; err.hidden = false; return; }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Checking…';

      /* server decides: locked? (status-only call — never an attempt) */
      let state = await gateLock(email, null);
      if (state && state.locked) { applyLock(state); return; }

      btn.innerHTML = '<span class="spinner"></span> Signing in…';
      const res = await T.auth.signIn(email, pw);

      /* report the outcome to the server ledger:
         success → wipes this identifier's failures; failure → counted */
      state = await gateLock(email, res.ok);

      if (res.ok) {
        btn.disabled = false;
        btn.textContent = 'Enter Admin Console';
        T.toast('Welcome back.');
        await gate();
        return;
      }

      /* could the 5th+ failure have tripped the server lock just now? */
      if (state && state.locked) { applyLock(state); return; }

      /* generic failure — never reveals whether the email exists */
      btn.disabled = false;
      btn.textContent = 'Enter Admin Console';
      err.textContent = 'Invalid email or password.';
      err.hidden = false;
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
    /* idempotent: re-login cycles and auth events must never wire the console
       twice — stacked submit listeners make one Save click post products twice */
    if (S.console) return;
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

    const [prod, cats, orders, items, profiles, names, msgs, subs, sizesRes] = await Promise.all([
      T.sb.from('products').select('*').order('created_at', { ascending: false }),
      T.sb.from('categories').select('*').order('created_at', { ascending: true }),
      T.sb.from('orders').select('*').order('created_at', { ascending: false }).limit(300),
      T.sb.from('order_items').select('*').limit(1000),
      T.sb.from('profiles').select('id, full_name, email').limit(1000),
      T.sb.from('products').select('id, name'),
      T.sb.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(300),
      T.sb.from('newsletter_subscribers').select('*').order('created_at', { ascending: false }).limit(2000),
      /* optional 0009 table — quiet until the migration runs */
      T.sb.from('product_sizes').select('*'),
    ]);

    if (seq !== loadAllSeq) return; // superseded

    S.products = rows(prod);
    S.categories = rows(cats);
    S.messages = rows(msgs);
    S.subs = rows(subs);
    S.sizeRows = sizesRes.error ? [] : (sizesRes.data || []);

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

    wireProductGallery();

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
        // remove the deleted product's own storage photos — rows vanish, but
        // without this the bucket fills with unreferenced copies over time
        (Array.isArray(p.images) ? p.images : []).concat(p.image_url || [])
          .filter(Boolean).forEach((u) => {
            const path = bucketPathOf(u);
            if (path) T.sb.storage.from('product-images').remove([path]).catch(() => {});
          });
        S.products = S.products.filter((x) => x.id !== id);
        paintStats(); paintProducts();
        T.toast('Product deleted and its photos removed.');
      }
    });
  }

  /* ------------------------------------------------- product photo gallery -- */
  /* Photos upload the moment they are picked/dropped (existing product-images
     bucket, admin-only write). Removal deletes the bucket object too, so no
     orphans pile up when the admin changes their mind before saving. The
     cover (main photo) choice is saved at index 0 and mirrored into image_url. */
  function wireProductGallery() {
    const drop = document.getElementById('prod-drop');
    const input = document.getElementById('prod-img-file');

    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', () => {
      addPhotos(Array.from(input.files || []));
      input.value = '';
    });

    ['dragenter', 'dragover'].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-drag'); }));
    ['dragleave', 'drop'].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-drag'); }));
    drop.addEventListener('drop', (e) => addPhotos(Array.from((e.dataTransfer || {}).files || [])));

    document.getElementById('prod-gallery').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { removePhoto(Number(rm.dataset.rm)); return; }
      const mv = e.target.closest('[data-mv]');
      if (mv) { movePhoto(Number(mv.dataset.mv), Number(mv.dataset.dir)); return; }
      const cov = e.target.closest('[data-cov]');
      if (cov) { setCover(Number(cov.dataset.cov)); }
    });
  }

  async function addPhotos(files) {
    const imgs = files.filter((f) => f && /^image\//.test(f.type));
    if (!imgs.length) { T.toast('Choose image files only.'); return; }
    if (S.prodPhotos.length >= MAX_PHOTOS) { T.toast('Photo limit is 10 per product.'); return; }

    const prodName = document.getElementById('prod-name').value.trim();
    let added = 0;
    for (const f of imgs) {
      if (S.prodPhotos.length >= MAX_PHOTOS) { T.toast('Photo limit is 10 per product.'); break; }
      const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `admin/${Date.now()}-${S.prodPhotos.length}-${slugify(prodName).slice(0, 40) || 'product'}.${ext}`;
      const up = await T.sb.storage.from('product-images').upload(path, f, {
        contentType: f.type || 'image/jpeg',
                                        cacheControl: '3600',
                                        upsert: false,
      });
      const m = dbMsg(up, `Upload failed for “${f.name}”.`);
      if (m) { T.toast(m); continue; }
      S.prodPhotos.push({
        url: T.sb.storage.from('product-images').getPublicUrl(path).data.publicUrl,
        name: f.name,
      });
      paintGallery();
      added += 1;
    }
    if (added) T.toast(`${added} photo${added > 1 ? 's' : ''} added.`);
  }

  function removePhoto(i) {
    const shot = S.prodPhotos[i];
    if (!shot) return;
    S.prodPhotos.splice(i, 1);
    if (S.prodCover >= S.prodPhotos.length) S.prodCover = Math.max(0, S.prodPhotos.length - 1);
    const path = bucketPathOf(shot.url);
    if (path) {
      /* Delete the bucket object only when NO other product still references
         this URL — two rows sharing a photo means deleting the file breaks
         the other product's card. Editing the form's own product is allowed. */
      const formId = Number(document.getElementById('prod-id').value || -1);
      const stillUsed = S.products.some((q) =>
        Number(q.id) !== formId && q.images.includes(shot.url));
      if (!stillUsed) {
        // best-effort cleanup — a frozen bucket object is harmless vs. breaking UX
        T.sb.storage.from('product-images').remove([path]).catch(() => {});
      }
    }
    paintGallery();
  }

  function setCover(i) { S.prodCover = i; paintGallery(); T.toast('Main photo updated.'); }

  /* reorder: swap the photo at i with its neighbour; the main-photo choice
     follows the photo it was set on, and the cover stays index 0 at save */
  function movePhoto(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= S.prodPhotos.length) return;
    const arr = S.prodPhotos;
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
    if (S.prodCover === i) S.prodCover = j;
    else if (S.prodCover === j) S.prodCover = i;
    paintGallery();
  }

  function bucketPathOf(url) {
    try { const u = new URL(url); return u.pathname.split('/storage/v1/object/public/product-images/')[1] || null; }
    catch { return null; }
  }

  function paintGallery() {
    const grid = document.getElementById('prod-gallery');
    const count = document.getElementById('prod-count');
    count.textContent = `${S.prodPhotos.length} / ${MAX_PHOTOS}` + (S.prodPhotos.length === MAX_PHOTOS ? ' — limit reached' : ' photos');
    if (!S.prodPhotos.length) {
      grid.hidden = true;
      grid.innerHTML = '';
      return;
    }
    grid.hidden = false;
    grid.innerHTML = S.prodPhotos.map((ph, i) => `
      <div class="gal-thumb${i === S.prodCover ? ' is-cover' : ''}">
        <img src="${ph.url}" alt="${T.esc(ph.name || 'Product photo ' + (i + 1))}" loading="lazy" draggable="false">
        ${i === S.prodCover ? '<span class="gal-cov">Cover</span>' : ''}
        <button class="gal-x" type="button" data-rm="${i}" aria-label="Remove photo ${i + 1}" title="Remove">×</button>
        <div class="gal-foot">
          <button class="gal-mv" type="button" data-mv="${i}" data-dir="-1" ${i === 0 ? 'hidden' : ''} aria-label="Move photo ${i + 1} left" title="Move left">←</button>
          <button class="gal-mv" type="button" data-mv="${i}" data-dir="1" ${i === S.prodPhotos.length - 1 ? 'hidden' : ''} aria-label="Move photo ${i + 1} right" title="Move right">→</button>
          <button class="gal-cov-btn" type="button" data-cov="${i}" ${i === S.prodCover ? 'hidden' : ''} title="Make this the cover photo">Main</button>
        </div>
      </div>`).join('');
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
    // per-size stock (0009): size rows when configured; a legacy product gets
    // its global stock prefilled in M so the first save converts it losslessly
    const szRows = p ? S.sizeRows.filter((r) => Number(r.product_id) === Number(p.id)) : [];
    const szMap = new Map(szRows.map((r) => [r.size, Math.max(0, Number(r.stock) || 0)]));
    document.querySelectorAll('#prod-sizes .sz-cell input').forEach((inp) => {
      inp.value = szRows.length
        ? (szMap.get(inp.dataset.sz) || 0)
        : (inp.dataset.sz === 'M' ? Math.max(0, num(p && p.stock)) : 0);
    });
    document.getElementById('prod-desc').value = p ? (p.description || '') : '';
    document.getElementById('prod-newflag').checked = p ? !!p.is_new : false;
    document.getElementById('prod-best').checked = p ? !!p.is_best_seller : false;
    document.getElementById('prod-active').checked = p ? !!p.is_active : true;

    // gallery: existing photos from the images column (legacy rows mirror in save path)
    const photos = Array.isArray(p && p.images) ? p.images.filter((u) => typeof u === 'string' && u) : [];
    S.prodPhotos = photos.map((u) => ({ url: u, name: 'product' + u.slice(-4) }));
    const cover = p ? (p.image_url || '') : '';
    const coverIdx = S.prodPhotos.findIndex((ph) => ph.url === cover);
    S.prodCover = coverIdx >= 0 ? coverIdx : 0;
    paintGallery();
    document.getElementById('prod-img-file').value = '';

    form.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('prod-name').focus();
  }

  function fillCategoryOptions(sel, selectedId) {
    sel.innerHTML = S.categories.map((c) =>
      `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>${T.esc(c.name)}</option>`).join('')
      || '<option value="">— add a category first —</option>';
  }

  /* wrapper: hard re-entry lock — stacked submit listeners, a double click or
     an Enter-key submit can all queue a second run; only the first may save */
  async function saveProduct() {
    if (S.prodSaving) return;
    S.prodSaving = true;
    try {
      await saveProductRun();
    } finally {
      S.prodSaving = false;
      const saveBtn = document.getElementById('prod-save');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save product'; }
    }
  }

  async function saveProductRun() {
    const saveBtn = document.getElementById('prod-save');
    const name = document.getElementById('prod-name').value.trim();
    const category_id = Number(document.getElementById('prod-cat').value) || null;
    const price = num(document.getElementById('prod-price').value, NaN);
    if (!name || !category_id || !Number.isFinite(price)) {
      T.toast('Name, category and a valid price are required.');
      return;
    }
    if (!S.prodPhotos.length) {
      T.toast('Add at least one product photo (it becomes the main image).');
      return;
    }

    // photos were uploaded on selection; order cover-first and mirror it in
    // image_url so cards, cart line items and order history keep working —
    // and dedupe (a URL picked twice should never appear twice on a card)
    const ordered = S.prodPhotos.slice();
    if (S.prodCover > 0) ordered.unshift(...ordered.splice(S.prodCover, 1));
    const images = [...new Set(ordered.map((ph) => ph.url))];

    /* every product shows ITS OWN photos: refuse to silently save a set that
       another product already wears (each card renders its row's image_url) */
    const formId = Number(document.getElementById('prod-id').value || -1);
    const dupeOwner = S.products.find((q) =>
      Number(q.id) !== formId && q.images.some((u) => images.includes(u)));
    if (dupeOwner) {
      const go = confirm(`This photo is already used by “${dupeOwner.name}”. Saving it here means both cards show the same image — save anyway?`);
      if (!go) return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner"></span> Saving…';
    try {
      // per-size stock (0009) — zero is allowed; an all-zero product simply
      // shows as out of stock on the storefront
      const sizeRows = Array.from(document.querySelectorAll('#prod-sizes .sz-cell input'))
        .map((inp) => ({ size: inp.dataset.sz, stock: Math.max(0, Math.trunc(num(inp.value))) }));
      const totalStock = sizeRows.reduce((s, r) => s + r.stock, 0);

      const originalRaw = document.getElementById('prod-orig').value;
      const payload = {
        name,
        description: document.getElementById('prod-desc').value.trim(),
        price: Math.round(price * 100) / 100,
        original_price: originalRaw === '' ? null : Math.round(num(originalRaw) * 100) / 100,
        image_url: images[0] || '',
        images,
        category_id,
        stock: totalStock,
        is_new: document.getElementById('prod-newflag').checked,
        is_best_seller: document.getElementById('prod-best').checked,
        is_active: document.getElementById('prod-active').checked,
      };

      const id = document.getElementById('prod-id').value;
      let pid = id ? Number(id) : null;
      const res = id
        ? await T.sb.from('products').update(payload).eq('id', pid)
        : await T.sb.from('products').insert(payload).select('id');

      const m = dbMsg(res, 'Could not save the product.');
      if (m) { T.toast(m); throw new Error('db'); }
      if (pid == null) {
        const inserted = Array.isArray(res.data) ? res.data[0] : null;
        pid = inserted ? Number(inserted.id) : null;
      }

      // every size row is written; the DB trigger re-sums products.stock
      if (pid != null) {
        const up = await T.sb.from('product_sizes').upsert(
          sizeRows.map((r) => ({ product_id: pid, size: r.size, stock: r.stock })),
          { onConflict: 'product_id,size' });
        const m2 = dbMsg(up, 'Product saved, but per-size stock could not be updated.');
        if (m2) T.toast(m2);
      }

      const base = id ? 'Product updated.' : 'Product added to the shop.';
      T.toast(totalStock === 0 ? `${base} All sizes are at 0 — it shows as out of stock.` : base);
      document.getElementById('prod-form').hidden = true;
      S.prodPhotos = [];
      S.prodCover = 0;
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
              <li><span>${it.quantity} × ${T.esc(it.name)}${it.size ? ` <span class="oi-size">size ${T.esc(it.size)}</span>` : ''}</span><span>${T.money(num(it.unit_price) * it.quantity)}</span></li>`).join('')
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