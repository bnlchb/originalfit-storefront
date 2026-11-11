/* ============================================================================
   THE ORIGINAL FIT — products.js
   Catalog data layer (Supabase only) + card rendering helpers.
   ============================================================================ */
'use strict';

window.TOF = window.TOF || {};

(function catalog(T) {
  const ig = (p) => Number(p) || 0;

  /* canonical size ladder for every product (0009) */
  /** Description renderer — admin-entered text becomes clean structured
      blocks instead of one merged paragraph:
      · every line stands on its own (<p> rows)
      · lines starting with -, * or • group into a styled <ul>
      · blank lines render as consistent paragraph breaks, exactly as typed
      Everything is escaped first so admin text can never inject HTML. */
  function descHTML(desc) {
    const lines = String(desc || '').split(/\r\n|\r|\n/).map((l) => l.trim());
    while (lines.length && !lines[0]) lines.shift();          // trim leading blanks
    while (lines.length && !lines[lines.length - 1]) lines.pop(); // trim trailing blanks
    const out = [];
    let list = null;
    const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
    for (const line of lines) {
      if (!line) { flush(); out.push('<div class="desc-sp"></div>'); continue; }
      const m = line.match(/^[-*\u2022\u25cf\u26ab\u25cb\u25e6\u25aa\u00b7\u2023\u2043]\s*(.+)$/);
      if (m) {
        list = list || [];
        list.push(`<li>${T.esc(m[1])}</li>`);
      } else {
        flush();
        out.push(`<p>${T.esc(line)}</p>`);
      }
    }
    flush();
    return out.join('');
  }

  const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

  /** Collapse raw product_sizes rows into [{size, stock}] ordered XS→XXL.
      Sizes outside the canonical ladder (e.g. 'One Size', migration 0011)
      are preserved and appended after it. Returns null when the product has
      no size rows (legacy: all sizes follow the product-level stock). */
  function normalizeSizes(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    const bySize = new Map(rows.map((r) => [r.size, Number(r.stock) || 0]));
    const out = SIZE_ORDER.map((s) => ({ size: s, stock: bySize.get(s) || 0 }));
    rows.forEach((r) => {
      if (!SIZE_ORDER.includes(r.size)) out.push({ size: String(r.size), stock: Number(r.stock) || 0 });
    });
    return out;
  }

  /** Map a live/demo DB row into the app shape. */
  function normalize(row, catSlug, catName, sizeRows) {
    if (!row) return null;
    const price = ig(row.price);
    const hasImage = typeof row.image_url === 'string' && row.image_url.length > 8;
    if (!row.name || !hasImage || !(price >= 0)) return null; // guard legacy/malformed rows
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      price,
      originalPrice: row.original_price && Number(row.original_price) > price ? Number(row.original_price) : null,
      imageUrl: row.image_url,
      images: Array.isArray(row.images) ? row.images.filter((u) => typeof u === 'string' && u) : [],
      categoryId: row.category_id,
      categorySlug: catSlug || row.category_slug || '',
      categoryName: catName || row.category_name || '',
      stock: Number(row.stock) || 0,
      sizes: normalizeSizes(sizeRows),
      isNew: !!row.is_new,
      isBestSeller: !!row.is_best_seller,
      createdAt: row.created_at || '',
    };
  }

  const state = {
    loaded: false,
    products: [],
    categories: [],
    loadPromise: null,
  };

  function applyRows(rows, cats) {
    state.products = rows;
    state.categories = cats;
    state.loaded = true;
    document.documentElement.classList.add('js-loaded');
  }

  async function refreshFromBackend() {
    await T.whenReady();

    let rows = [];
    let cats = [];

    if (T.mode === 'supabase') {
      /* --- live: separate selects then client-side join (robust) --- */
      const [p, c, sz] = await Promise.all([
        T.sb.from('products').select('*').eq('is_active', true).order('created_at', { ascending: false }),
        T.sb.from('categories').select('*').order('id'),
        /* optional 0009 table — a failed read simply leaves every product in
           legacy mode, where all sizes follow the product-level stock */
        T.sb.from('product_sizes').select('*'),
      ]);
      if (!p.error && !c.error) {
        const catById = new Map((c.data || []).map((c) => [Number(c.id), c]));
        const sizesByProduct = new Map();
        if (!sz.error) {
          (sz.data || []).forEach((r) => {
            const pid = Number(r.product_id);
            if (!sizesByProduct.has(pid)) sizesByProduct.set(pid, []);
            sizesByProduct.get(pid).push(r);
          });
        }
        rows = (p.data || []).map((row) => {
          const cat = catById.get(Number(row.category_id));
          return normalize(row, cat && cat.slug, cat && cat.name, sizesByProduct.get(Number(row.id)));
        }).filter(Boolean);
        cats = (c.data || []).map((c) => ({
          id: Number(c.id), slug: c.slug, name: c.name,
          imageUrl: c.image_url || '', description: c.description || '',
        }));
      } else {
        console.warn('[TOF] catalog fetch failed — catalog stays empty until Supabase responds:', (p.error && p.error.message) || (c.error && c.error.message));
      }
    }

    applyRows(rows, cats);
    return state;
  }

  async function loadOnce(force) {
    if (state.loaded && !force) return state;
    if (state.loadPromise && !force) return state.loadPromise;
    /* One fetch per page view — refreshFromBackend itself waits for the
       Supabase connection to settle before querying. Pages render their
       skeleton placeholders while this resolves. */
    state.loadPromise = refreshFromBackend();
    return state.loadPromise;
  }

  const cmp = {
    'newest': (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
    'best':   (a, b) => (Number(b.isBestSeller) - Number(a.isBestSeller)) || String(b.createdAt).localeCompare(String(a.createdAt)),
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
    'name': (a, b) => a.name.localeCompare(b.name),
  };

  /**
   * List with shop filters:
   * { category?: slug, sale?: boolean, q?: string, sort?: 'newest'|'best'|'price-asc'|'price-desc'|'name', limit?: number }
   */
  async function list(opts = {}) {
    await loadOnce();
    let out = state.products.slice();
    if (opts.category) out = out.filter((p) => p.categorySlug === opts.category);
    if (opts.sale) out = out.filter((p) => p.originalPrice);
    if (opts.q) {
      const q = String(opts.q).toLowerCase();
      out = out.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.categoryName.toLowerCase().includes(q));
    }
    out.sort(cmp[opts.sort] || cmp.newest);
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  }

  async function get(id) {
    await loadOnce();
    const n = Number(id);
    return state.products.find((p) => Number(p.id) === n) || null;
  }

  async function categories() {
    await loadOnce();
    return state.categories;
  }

  async function search(q, limit = 6) {
    return list({ q: String(q).trim(), sort: 'best', limit });
  }

  /* -------------------------------------------------------- presentation -- */
  const SVG_HEART =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">' +
    '<path d="M12 20.5c-4.9-3.5-8.4-6.6-8.4-10a4.8 4.8 0 0 1 8.4-3.2 4.8 4.8 0 0 1 8.4 3.2c0 3.4-3.5 6.5-8.4 10z"/></svg>';

  function badgeOf(p) {
    if (p.originalPrice) return { cls: 'badge-sale', label: 'Sale' };
    if (p.isNew) return { cls: 'badge-new', label: 'New' };
    if (p.isBestSeller) return { cls: 'badge-best', label: 'Best Seller' };
    return null;
  }

  function cardHTML(p, opts = {}) {
    const base = opts.base !== undefined ? opts.base : T.base;
    const productUrl = `${base}product.html?id=${encodeURIComponent(p.id)}`;
    const b = badgeOf(p);
    const wished = T.wishlist && T.wishlist.has(p.id);
    return `
      <article class="product-card">
        <div class="p-media">
          <a href="${productUrl}" aria-label="View ${T.esc(p.name)}">
            <img src="${p.imageUrl}" alt="${T.esc(p.name)} — ${T.esc(p.categoryName) || 'THE ORIGINAL FIT'}" loading="lazy" decoding="async">
            ${b ? `<span class="badge ${b.cls} no-anim">${b.label}</span>` : ''}
          </a>
          <button class="wish-btn${wished ? ' is-active' : ''}" type="button" data-wish="${p.id}"
                  aria-pressed="${wished}" aria-label="${wished ? 'Remove from' : 'Add to'} wishlist">${SVG_HEART}</button>
        </div>
        <div class="p-info">
          <h3 class="p-name"><a href="${productUrl}">${T.esc(p.name)}</a></h3>
          <div class="p-price">
            <span class="now">${T.money(p.price)}</span>
            ${p.originalPrice ? `<s class="was">${T.money(p.originalPrice)}</s>` : ''}
          </div>
          <button class="btn btn-sm p-add" type="button" data-add="${p.id}">Add to Cart</button>
        </div>
      </article>`;
  }

  async function renderCards(container, items, opts = {}) {
    if (!container) return;
    container.innerHTML = items.length
      ? items.map((p, i) => cardHTML(p, opts).replace('<article class="product-card">', `<article class="product-card reveal" style="--d:${Math.min(i * 60, 360)}ms">`)).join('')
      : (opts.emptyHTML || '');
    if (opts.reveal !== false && T.ui) T.ui.observeReveals(container);
  }

  function skeletonCards(container, n = 4) {
    if (!container) return;
    container.innerHTML = Array.from({ length: n }, () => `
      <div class="product-card" aria-hidden="true">
        <div class="skeleton sk-media"></div>
        <div class="skeleton sk-line"></div>
        <div class="skeleton sk-line w60"></div>
      </div>`).join('');
  }

  T.products = { loadOnce, list, get, categories, search, cardHTML, renderCards, skeletonCards, badgeOf, normalize, descHTML, normalizeSizes };
})(window.TOF);
