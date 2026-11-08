/* ============================================================================
   THE ORIGINAL FIT — main.js
   UI orchestration: header, mobile menu, cart drawer, global add/wishlist
   delegation, reveals, hero slider, newsletter, and page-specific inits.
   ============================================================================ */
'use strict';

window.TOF = window.TOF || {};

(function mainModule(T) {
  const qs  = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  T.ui = {
    qs, qsa,
    observeReveals(root = document) {
      const els = qsa('.reveal:not(.in-view)', root);
      if (!('IntersectionObserver' in window)) {
        els.forEach((el) => el.classList.add('in-view'));
        return;
      }
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('in-view');
            io.unobserve(en.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
      els.forEach((el) => io.observe(el));
    },
  };

  /* ------------------------------------------------------------ helpers -- */
  const PRODUCTS_URL = (id) => T.url('product.html?id=' + encodeURIComponent(id));
  const SHOP_URL = (extra = '') => T.url('shop.html') + (extra ? (extra.startsWith('?') ? '' : '?') + extra : '');

  function lockScroll(on) {
    document.body.classList.toggle('no-scroll', !!on);
    // preserve scrollbar width to avoid layout shift on desktop
    if (on) {
      const sw = window.innerWidth - document.documentElement.clientWidth;
      if (sw > 0) document.body.style.paddingRight = sw + 'px';
    } else {
      document.body.style.paddingRight = '';
    }
  }

  function paintCartCount() {
    const badge = qs('#cart-count');
    if (!badge) return;
    const n = T.cart.count();
    badge.hidden = n === 0;
    badge.textContent = n > 9 ? '9+' : String(n);
  }

  function bumpCartCount() {
    paintCartCount();
    const badge = qs('#cart-count');
    if (!badge) return;
    badge.classList.remove('bump');
    void badge.offsetWidth; // restart animation
    badge.classList.add('bump');
  }

  /* -------------------------------------------------------------- header -- */
  function initHeader() {
    const header = qs('#site-header');
    if (!header) return;

    const isSolidPage = document.body.classList.contains('page-solid');
    const update = () => {
      header.classList.toggle('is-solid', window.scrollY > 12 || isSolidPage);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });

    // active nav underline
    const page = document.body.dataset.page || '';
    qsa('[data-nav]').forEach((a) => {
      a.classList.toggle('is-active', a.dataset.nav === page);
    });

    // authentication-aware account link
    T.whenReady().then(() => T.auth.ready()).then(() => {
      const user = T.auth.user();
      qsa('[data-auth-link]').forEach((a) => {
        a.href = user ? T.url('account.html') : T.url('login.html');
        a.title = user ? 'My account' : 'Sign in';
      });
    });
    document.addEventListener('tof:auth', () => {
      const user = T.auth.user();
      qsa('[data-auth-link]').forEach((a) => {
        a.href = user ? T.url('account.html') : T.url('login.html');
      });
    });
  }

  /* --------------------------------------------------------- mobile menu -- */
  function initMobileMenu() {
    const burger = qs('#hamburger');
    const menu = qs('#mobile-menu');
    if (!burger || !menu) return;

    function open() {
      burger.classList.add('is-open');
      menu.classList.add('is-open');
      burger.setAttribute('aria-expanded', 'true');
      burger.setAttribute('aria-label', 'Close menu');
      document.body.classList.add('no-scroll');
    }
    function close() {
      burger.classList.remove('is-open');
      menu.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      burger.setAttribute('aria-label', 'Open menu');
      document.body.classList.remove('no-scroll');
    }
    burger.addEventListener('click', () => (burger.classList.contains('is-open') ? close() : open()));
    qsa('a', menu).forEach((a) => a.addEventListener('click', close));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    window.matchMedia('(min-width: 941px)').addEventListener?.('change', (e) => { if (e.matches) close(); });
  }

  /* ---------------------------------------------------------- cart drawer -- */
  function drawerItemHTML(it) {
    return `
      <div class="cart-item" data-key="${it.key}">
        <img src="${it.imageUrl}" alt="${T.esc(it.name)}">
        <div class="ci-info">
          <h4 class="ci-name"><a href="${PRODUCTS_URL(it.id)}">${T.esc(it.name)}</a></h4>
          <div class="ci-size-chips">
            ${T.cart.SIZES.map((s) => `<button type="button" class="chip${s === it.size ? ' is-on' : ''}" data-size="${s}">${s}</button>`).join('')}
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

  function renderDrawer() {
    const listEl = qs('#cart-items');
    if (!listEl) return;
    const items = T.cart.read();
    const sub = T.cart.subtotal();
    const freeAt = T.cart.freeShippingAt();

    listEl.innerHTML = items.length
      ? items.map(drawerItemHTML).join('')
      : `
        <div class="cd-empty">
          <p>Your cart is still empty.</p>
          <a class="btn" href="${SHOP_URL()}">Shop Now <span class="arrow">→</span></a>
        </div>`;

    const note = qs('#cart-ship-note');
    if (note) {
      if (!items.length) {
        note.innerHTML = '<b>Free shipping on orders over 500 DH</b>';
      } else if (sub >= freeAt) {
        note.innerHTML = '<b>✓ Free shipping unlocked</b>';
      } else {
        const left = freeAt - sub;
        const pct = Math.min(100, Math.round((sub / freeAt) * 100));
        note.innerHTML = `You are <b>${T.money(left)}</b> away from <b>free shipping</b>
          <span class="bar"><i style="width:${pct}%"></i></span>`;
      }
    }

    const countEl = qs('#drawer-count');
    if (countEl) countEl.textContent = `(${items.reduce((s, i) => s + i.qty, 0)})`;
    subtotalEl();
  }

  function subtotalEl() {
    const el = qs('#drawer-subtotal');
    if (el) el.textContent = T.money(T.cart.subtotal());
  }

  function initCartDrawer() {
    const drawer = qs('#cart-drawer');
    const backdrop = qs('#drawer-backdrop');
    if (!drawer || !backdrop) return;

    const itemsEl = qs('#cart-items');
    T.cartPageDelegation(itemsEl); // reuse qty/size/remove handling from cart.js
    itemsEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-remove]')) renderDrawer();
    });

    function open() {
      renderDrawer();
      drawer.classList.add('is-open');
      backdrop.classList.add('is-open');
      document.body.classList.add('no-scroll');
      qs('.cd-close', drawer)?.focus?.();
    }
    function close() {
      drawer.classList.remove('is-open');
      backdrop.classList.remove('is-open');
      document.body.classList.remove('no-scroll');
    }

    qs('#cart-open')?.addEventListener('click', open);
    qs('#cd-close')?.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    // links inside drawer footer
    qsa('[data-cart-link]').forEach((a) => { a.href = T.url('cart.html'); });

    document.addEventListener('tof:cart', () => { paintCartCount(); if (drawer.classList.contains('is-open')) renderDrawer(); });

    paintCartCount();
  }

  /* -------------------------------------------------- global interactions -- */
  function initGlobalDelegation() {
    document.addEventListener('click', async (e) => {
      const addBtn = e.target.closest('[data-add]');
      if (addBtn) {
        const id = Number(addBtn.dataset.add);
        const p = await T.products.get(id);
        if (!p) return;
        addBtn.classList.add('added');
        setTimeout(() => addBtn.classList.remove('added'), 520);
        const res = T.cart.add(p, 'M', 1);
        T.toast(res === 'increased' ? 'Quantity updated in cart.' : `${p.name} — added to cart (size M).`);
        bumpCartCount();
        // open the drawer for immediate feedback
        const drawer = qs('#cart-drawer');
        if (drawer && !drawer.classList.contains('is-open')) {
          qs('#cart-open')?.click();
        }
        return;
      }

      const heart = e.target.closest('[data-wish]');
      if (heart) {
        const id = Number(heart.dataset.wish);
        const res = await T.wishlist.toggle(id);
        if (res === 'added') T.toast('Saved to wishlist.');
        if (res === 'removed') T.toast('Removed from wishlist.');
        if (res === null) T.toast('Product not found.');
      }
    });
  }

  /* ------------------------------------------------------------ newsletter -- */
  function initNewsletter() {
    qsa('#newsletter-form, [data-newsletter]').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = form.querySelector('input[type="email"]');
        const btn = form.querySelector('button');
        if (!input.value.trim()) return;
        btn.disabled = true;
        const res = await T.api.subscribe(input.value.trim());
        btn.disabled = false;
        if (res.ok && !res.dup) {
          T.toast('Welcome to THE ORIGINAL FIT — you are subscribed.');
          form.reset();
        } else if (res.dup) {
          T.toast('You are already subscribed.');
          form.reset();
        } else {
          T.toast(res.error || 'Subscription failed — try again.');
        }
      });
    });
  }

  /* ---------------------------------------------------------- hero slider -- */
  function initHeroSlider() {
    const hero = qs('#hero');
    if (!hero) return;
    const slides = qsa('.hero-slide', hero);
    const dotsWrap = qs('.hero-dots', hero);
    if (!slides.length || !dotsWrap) return;

    let index = 0;
    let timer = null;

    function go(i) {
      index = (i + slides.length) % slides.length;
      slides.forEach((s, n) => s.classList.toggle('is-active', n === index));
      qsa('.hero-dot', dotsWrap).forEach((d, n) => d.classList.toggle('is-active', n === index));
    }

    dotsWrap.innerHTML = slides.map((_, n) =>
      `<button class="hero-dot${n === 0 ? ' is-active' : ''}" aria-label="Show slide ${n + 1}"></button>`).join('');
    qsa('.hero-dot', dotsWrap).forEach((d, n) => d.addEventListener('click', () => { go(n); restart(); }));

    go(0);
    function restart() {
      clearInterval(timer);
      timer = setInterval(() => go(index + 1), 6500);
    }
    restart();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearInterval(timer); else restart();
    });
  }

  /* ------------------------------------------------------------ home page -- */
  async function initHomePage() {
    const grid = qs('#home-grid');
    if (grid) {
      T.products.skeletonCards(grid, 4);
      const items = await T.products.list({ sort: 'newest', limit: 4 });
      await T.products.renderCards(grid, items);
    }

    /* Our Collections — rendered live from the categories table */
    const colGrid = qs('#home-collections');
    if (colGrid) {
      const cats = await T.products.categories();
      colGrid.innerHTML = cats.map((c, i) => `
        <a class="collection-card reveal" href="${SHOP_URL('category=' + c.slug)}" style="--d:${Math.min(i * 90, 360)}ms">
          <img src="${c.imageUrl}" alt="${T.esc(c.name)} collection" loading="lazy">
          <div class="cc-body">
            <h3 class="cc-name">${T.esc(c.name)}</h3>
            <span class="cc-link">Discover <span class="arrow">→</span></span>
          </div>
        </a>`).join('');
      T.ui.observeReveals(colGrid);
    }
  }

  /* ------------------------------------------------------------ shop page -- */
  async function initShopPage() {
    const grid = qs('#shop-grid');
    if (!grid) return;

    const params = new URLSearchParams(location.search);
    const state = {
      category: params.get('category') || '',
      sale: params.get('filter') === 'sale',
      q: params.get('q') || '',
      sort: params.get('sort') || 'best',
    };

    const chipsWrap = qs('#chips');
    const sortSel = qs('#sort');
    const qInput = qs('#shop-q');
    const countEl = qs('#result-count');
    const emptyEl = qs('#shop-empty');

    if (qInput) qInput.value = state.q;
    if (sortSel) sortSel.value = state.sort;

    function pushURL() {
      const usp = new URLSearchParams();
      state.category && usp.set('category', state.category);
      state.sale && usp.set('filter', 'sale');
      state.q.trim() && usp.set('q', state.q.trim());
      state.sort !== 'best' && usp.set('sort', state.sort);
      const q = usp.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
    }

    async function refresh() {
      T.products.skeletonCards(grid, 8);
      const items = await T.products.list({
        category: state.category || undefined,
        sale: state.sale || undefined,
        q: state.q.trim() || undefined,
        sort: state.sort,
      });
      countEl && (countEl.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`);
      grid.innerHTML = '';
      await T.products.renderCards(grid, items, {
        emptyHTML: items.length ? '' : '',
      });
      emptyEl.hidden = items.length > 0;
      const title = qs('#shop-title');
      if (title) {
        const cat = items[0] && items[0].categoryName && state.category ? items[0].categoryName : 'ALL PRODUCTS';
        title.textContent = state.sale ? 'ON SALE' : cat;
      }
    }

    if (chipsWrap) {
      const cats = await T.products.categories();
      const chips = [`<button class="fchip${!state.category && !state.sale ? ' is-on' : ''}" data-cat="">All</button>`]
        .concat(cats.map((c) =>
          `<button class="fchip${state.category === c.slug ? ' is-on' : ''}" data-cat="${c.slug}">${T.esc(c.name)}</button>`))
        .concat([`<button class="fchip${state.sale ? ' is-on' : ''}" data-sale="1">On Sale</button>`]);
      chipsWrap.innerHTML = chips.join('');

      chipsWrap.addEventListener('click', (e) => {
        const chip = e.target.closest('.fchip');
        if (!chip) return;
        qsa('.fchip', chipsWrap).forEach((c) => c.classList.remove('is-on'));
        chip.classList.add('is-on');
        if (chip.dataset.sale) {
          state.sale = true; state.category = '';
          qsa('[data-cat]', chipsWrap).forEach((c) => { if (c.dataset.cat) c.classList.remove('is-on'); });
        } else {
          state.category = chip.dataset.cat; state.sale = false;
          const saleChip = chipsWrap.querySelector('[data-sale]');
          if (saleChip) saleChip.classList.remove('is-on');
        }
        pushURL(); refresh();
      });
    }

    sortSel && sortSel.addEventListener('change', () => { state.sort = sortSel.value; pushURL(); refresh(); });
    if (qInput) {
      let deb;
      qInput.addEventListener('input', () => {
        clearTimeout(deb);
        deb = setTimeout(() => { state.q = qInput.value; pushURL(); refresh(); }, 260);
      });
    }
    qs('#shop-clear')?.addEventListener('click', () => {
      state.category = ''; state.sale = false; state.q = ''; state.sort = 'best';
      if (qInput) qInput.value = '';
      if (sortSel) sortSel.value = 'best';
      pushURL(); refresh();
      qs('#shop-grid') && document.dispatchEvent(new Event('tof:filters-cleared'));
      qsa('.fchip', chipsWrap).forEach((c) => c.classList.toggle('is-on', !c.dataset.cat && !c.dataset.sale));
    });

    await refresh();
  }

  /* ------------------------------------------------------- product page -- */
  async function initPDP() {
    const shell = qs('#pdp-root');
    if (!shell) return;

    const id = Number(new URLSearchParams(location.search).get('id'));
    const p = await T.products.get(id);

    const notFound = qs('#pdp-not-found');
    if (!p) {
      notFound.hidden = false;
      shell.hidden = true;
      return;
    }
    notFound.hidden = true;
    shell.hidden = false;

    // multi-photo gallery — cover first (falls back to the single image_url);
    // swipeable, arrows + thumbnail strip + 1/10 counter, keyed Left/Right too
    const gallery = (p.images && p.images.length) ? p.images.filter((u) => typeof u === 'string' && u) : [p.imageUrl];
    const media = qs('#pdp-media');
    const thumbs = qs('#pdp-thumbs');
    const countEl = qs('#pdp-count');
    const multi = gallery.length > 1;
    let gi = 0;

    const paint = (i) => {
      gi = i < 0 ? gallery.length - 1 : (i >= gallery.length ? 0 : i); // wrap-around
      const el = qs('#pdp-img');
      el.classList.add('is-swap');
      el.src = gallery[gi];
      el.alt = p.name + ' — photo ' + (gi + 1) + ' of ' + gallery.length + (p.categoryName ? ` — ${p.categoryName}` : '');
      if (multi) {
        countEl.hidden = false;
        countEl.textContent = (gi + 1) + ' / ' + gallery.length;
        qsa('#pdp-thumbs .pdpt').forEach((t, k) => t.classList.toggle('is-on', k === gi));
      }
    };
    if (multi) {
      // thumbnail strip below the media + 1/N counter + page arrows revealed
      countEl.hidden = false;
      qs('#pdp-prev').hidden = false;
      qs('#pdp-next').hidden = false;
      thumbs.hidden = false;
      thumbs.innerHTML = gallery.map((u, k) =>
        `<button class="pdpt${k === 0 ? ' is-on' : ''}" type="button" aria-label="Photo ${k + 1}" draggable="false"><img src="${u}" alt="" loading="lazy" draggable="false"></button>`).join('');
      thumbs.addEventListener('click', (e) => {
        const b = e.target.closest('.pdpt');
        if (b) paint(qsa('#pdp-thumbs .pdpt').indexOf(b));
      });
      qs('#pdp-prev').addEventListener('click', () => paint(gi - 1));
      qs('#pdp-next').addEventListener('click', () => paint(gi + 1));
    }

    if (multi) { media.classList.add('has-multi'); }

    // fullscreen viewer (brand-consistent): click any photo → large, clear view
    const lb = qs('#pdp-lb');
    const lbImg = qs('#pdp-lb-img');
    const lbCount = qs('#pdp-lb-count');
    const lbClose = qs('#pdp-lb-close');
    const lbPrev = qs('#pdp-lb-prev');
    const lbNext = qs('#pdp-lb-next');

    const lbSync = () => {
      lbImg.src = gallery[gi];
      lbImg.alt = p.name + ' — photo ' + (gi + 1) + ' of ' + gallery.length + ' (large view)';
      lbCount.hidden = !multi;
      lbCount.textContent = (gi + 1) + ' / ' + gallery.length;
      lbPrev.hidden = !multi;
      lbNext.hidden = !multi;
    };
    const openLB = () => {
      if (!lb.hidden) return;
      document.body.classList.add('lb-open');
      lb.hidden = false;
      lbSync();
    };
    const closeLB = () => {
      if (lb.hidden) return;
      document.body.classList.remove('lb-open');
      lb.hidden = true;
    };

    lbClose.addEventListener('click', closeLB);
    lbPrev.addEventListener('click', () => { paint(gi - 1); lbSync(); });
    lbNext.addEventListener('click', () => { paint(gi + 1); lbSync(); });
    // backdrop click closes (clicks on the photo, arrows and counter don't)
    lb.addEventListener('click', (e) => {
      if (!e.target.closest('.lb-img, .lb-arrow, .lb-close, .lb-count')) closeLB();
    });

    // click the main image (or tap, not drag) → fullscreen; swipe threshold
    // keeps arrows' thumb-vs-photo interactions distinct
    let sx = 0, sy = 0, down = false, downOnImg = false;
    media.addEventListener('pointerdown', (e) => {
      down = true;
      downOnImg = !!(e.target && e.target.id === 'pdp-img');
      sx = e.clientX; sy = e.clientY;
    });
    media.addEventListener('pointerup', (e) => {
      if (!down) return;
      down = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (multi && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
        paint(dx < 0 ? gi + 1 : gi - 1);
        return;
      }
      if (downOnImg && Math.abs(dx) < 8 && Math.abs(dy) < 8) openLB();
    });
    media.addEventListener('pointercancel', () => { down = false; });

    // keyboard: ←/→ browse photos (in viewer and out), Escape closes the viewer
    document.addEventListener('keydown', (e) => {
      const typing = /^(input|textarea|select)$/i.test((e.target || {}).tagName || '');
      if (typing) return;
      if (e.key === 'Escape') { closeLB(); return; }
      if (e.key === 'ArrowLeft') { paint(gi - 1); lbSync(); return; }
      if (e.key === 'ArrowRight') { paint(gi + 1); lbSync(); }
    });

    paint(0);
    const badgeEl = qs('#pdp-badge');
    const b = T.products.badgeOf(p);
    if (b) { badgeEl.hidden = false; badgeEl.className = 'badge ' + b.cls; badgeEl.textContent = b.label; }

    qs('#pdp-cat').textContent = p.categoryName || 'T-Shirts';
    qs('#pdp-title').textContent = p.name;
    qs('#pdp-desc').textContent = p.description || 'The THE ORIGINAL FIT staple — premium quality, timeless design.';
    qs('#pdp-bc-current').textContent = p.name;
    const bcCat = qs('#pdp-bc-cat');
    bcCat.textContent = p.categoryName;
    bcCat.href = SHOP_URL('category=' + p.categorySlug);

    qs('#pdp-price-now').textContent = T.money(p.price);
    const was = qs('#pdp-price-was');
    if (p.originalPrice) {
      was.hidden = false;
      was.querySelector('s').textContent = T.money(p.originalPrice);
    }
    const save = qs('#pdp-save');
    if (p.originalPrice) {
      save.hidden = false;
      save.textContent = 'SAVE ' + Math.round((1 - p.price / p.originalPrice) * 100) + '%';
    }
    qs('#pdp-stock').textContent = p.stock > 0 ? 'In stock and ready to ship' : 'Out of stock';

    // sizes + qty
    let size = 'M';
    qsa('#pdp-sizes .chip').forEach((chip) => {
      chip.classList.toggle('is-on', chip.dataset.size === size);
      chip.addEventListener('click', () => {
        size = chip.dataset.size;
        qsa('#pdp-sizes .chip').forEach((c) => c.classList.toggle('is-on', c === chip));
        qs('#pdp-size-hint').textContent = 'Size ' + size + ' selected';
      });
    });

    let qty = 1;
    const qtyEl = qs('#pdp-qty-val');
    qs('#pdp-qty-dec').addEventListener('click', () => { qty = Math.max(1, qty - 1); qtyEl.textContent = qty; });
    qs('#pdp-qty-inc').addEventListener('click', () => { qty = Math.min(9, qty + 1); qtyEl.textContent = qty; });

    qs('#pdp-add').addEventListener('click', () => {
      T.cart.add(p, size, qty);
      bumpCartCount();
      T.toast(`${p.name} × ${qty} — added to cart (size ${size}).`);
      const drawer = qs('#cart-drawer');
      if (drawer && !drawer.classList.contains('is-open')) qs('#cart-open')?.click();
    });

    const wishBtn = qs('#pdp-wish');
    wishBtn.dataset.wish = p.id;
    wishBtn.setAttribute('aria-pressed', T.wishlist.has(p.id));
    wishBtn.classList.toggle('is-active', T.wishlist.has(p.id));

    // related products
    const related = await T.products.list({ category: p.categorySlug, limit: 4 });
    const filtered = related.filter((r) => r.id !== p.id).slice(0, 4);
    const relWrap = qs('#related-grid');
    await T.products.renderCards(relWrap, filtered);
  }

  /* --------------------------------------------------- collections page -- */
  async function initCollectionsPage() {
    const grid = qs('#collections-grid');
    if (!grid) return;
    const paint = async () => {
      const cats = await T.products.categories();
      grid.innerHTML = cats.map((c) => `
        <a class="collection-card reveal" href="${SHOP_URL('category=' + c.slug)}" style="--d:${Math.min(cats.indexOf(c) * 90, 360)}ms">
          <img src="${c.imageUrl}" alt="${T.esc(c.name)} collection">
          <div class="cc-body">
            <h3 class="cc-name">${T.esc(c.name)}</h3>
            <span class="cc-link">Discover <span class="arrow">→</span></span>
          </div>
        </a>`).join('');
      T.ui.observeReveals(grid);
    };
    await paint();
  }

  /* --------------------------------------------------- contact/about page -- */
  function initContactPage() {
    const form = qs('#contact-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      const data = Object.fromEntries(new FormData(form));
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Sending…';
      const res = await T.api.sendContact({
        name: data.name, email: data.email, subject: data.subject || 'General', message: data.message,
      });
      btn.disabled = false;
      btn.textContent = 'Send Message';
      if (res.ok) {
        form.hidden = true;
        const ok = qs('#contact-success');
        ok.hidden = false;
        ok.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        const err = qs('#contact-error');
        err.hidden = false;
        err.textContent = res.error || 'Could not send the message — try again.';
      }
    });
    qs('#contact-again')?.addEventListener('click', (e) => {
      e.preventDefault();
      qs('#contact-success').hidden = true;
      const f = qs('#contact-form');
      f.hidden = false;
      f.reset();
    });
  }

  /* ------------------------------------------------------------- boot ------ */
  function boot() {
    initHeader();
    initMobileMenu();
    initCartDrawer();
    initGlobalDelegation();
    initNewsletter();
    initHeroSlider();
    initHomePage();
    initShopPage();
    initPDP();
    initCollectionsPage();
    initContactPage();
    initCartPageBridge();
    T.ui.observeReveals(document);

    const yearEl = qs('#year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  }

  function initCartPageBridge() {
    const listEl = qs('#cart-list');
    if (!listEl) return;
    T.cartPageDelegation(listEl);
    T.cart.initCartPage();
  }

  /* Boot on DOM ready — grid placeholders render while the catalog loads
     from Supabase, then the live products/categories are painted in. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.TOF);
