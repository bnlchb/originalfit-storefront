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
    const snap = Array.isArray(it.sizes) && it.sizes.length ? it.sizes : null;
    /* chips follow the item's own size set: ladder products (and legacy
       lines) show the six canonical sizes, One Size lines show only theirs —
       the same rule the PDP applies, so the two can never drift apart */
    const ownSizes = snap ? snap.filter((x) => !T.cart.SIZES.includes(x.size)) : [];
    const chipSizes = ownSizes.length ? ownSizes.map((x) => x.size) : T.cart.SIZES;
    const chipFor = (s) => {
      const row = snap && (snap.find((x) => x.size === s) || {});
      const out = snap ? ((row.stock || 0) <= 0) : false;
      return `<button type="button" class="chip${s === it.size ? ' is-on' : ''}${out ? ' is-out' : ''}" aria-pressed="${s === it.size}"${out ? ' disabled title="Out of stock"' : ''} data-size="${T.esc(s)}">${T.esc(s)}</button>`;
    };
    return `
      <div class="cart-item" data-key="${it.key}">
        <img src="${it.imageUrl}" alt="${T.esc(it.name)}">
        <div class="ci-info">
          <h4 class="ci-name"><a href="${PRODUCTS_URL(it.id)}">${T.esc(it.name)}</a></h4>
          <div class="ci-size-chips">
            ${chipSizes.map(chipFor).join('')}
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

        // card-level add: pick the first available size (legacy products
        // without size rows keep ordering as "M" while their stock lasts)
        const snap = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : null;
        const firstAvail = snap
          ? (snap.find((x) => (x.stock || 0) > 0) || {}).size || null
          : ((Number(p.stock) || 0) > 0 ? 'M' : null);
        if (!firstAvail) { T.toast(`${p.name} is out of stock.`); return; }

        const res = T.cart.add(p, firstAvail, 1);
        if (res === 'blocked') {
          T.toast(firstAvail === 'One Size' ? 'One Size is out of stock.' : `Size ${firstAvail} is out of stock.`);
          return;
        }
        if (res === 'clamped') T.toast('Limited stock — cart updated to what is available.');
        else T.toast(firstAvail === 'One Size' ? `${p.name} — added to cart.` : `${p.name} — added to cart (size ${firstAvail}).`);
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
  /* Dynamic hero carousel. Fetches active slides from Supabase (hero_slides
     table) and renders them as full-bleed images with fade/slide transitions.
     Falls back to the static SVG logo when Supabase is not connected or when
     no slides exist — the page never breaks. */
  async function initHeroSlider() {
    const hero = qs('#hero');
    if (!hero) return;

    /* wait for Supabase to be ready before fetching slides */
    await T.whenReady();

    const slidesWrap = qs('.hero-slides', hero);
    const dotsWrap = qs('.hero-dots', hero);          /* optional — degrade, never bail */
    const btnPrev = qs('.hero-arrow-prev', hero);
    const btnNext = qs('.hero-arrow-next', hero);
    if (!slidesWrap || !btnPrev || !btnNext) return;

    /* the static brand slide painted in the HTML — re-inserted whenever no
       DB slide is available, so the hero is never an empty gradient */
    const fallbackSlide = slidesWrap.querySelector('.hero-slide--logo');

    /* controls start hidden; render() reveals them only when slides exist —
       no orphaned arrows while loading, in demo mode, or after an error */
    btnPrev.hidden = true;
    btnNext.hidden = true;

    /* autoplay interval in ms — easy to configure */
    const AUTOPLAY_MS = 5000;

    let slides = [];          // [{ image_url, alt_text, link_url, id }]
    let index = 0;
    let timer = null;
    let animating = false;    // re-entry guard during transitions

    /* Fetch slides from Supabase. In demo mode (no SB) we keep slides empty
       so the fallback logo remains visible. */
    async function loadSlides() {
      if (!T.sb) { render(); return; }    /* demo mode → fallback emblem stays */
      const { data, error } = await T.sb
        .from('hero_slides')
        .select('id, image_url, alt_text, link_url, sort_order, is_active')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) {
        console.warn('[TOF hero] could not load slides:', error.message);
        render();                         /* error → fallback, controls hidden */
        return;
      }
      slides = Array.isArray(data) ? data : [];
      render();
    }

    function render() {
      if (dotsWrap) dotsWrap.innerHTML = '';
      slidesWrap.innerHTML = '';

      if (!slides.length) {
        /* nothing to show — re-paint the brand emblem and keep the controls
           hidden; the hero stays premium instead of an empty gradient */
        if (fallbackSlide) slidesWrap.appendChild(fallbackSlide.cloneNode(true));
        btnPrev.hidden = true;
        btnNext.hidden = true;
        dotsWrap?.closest('.hero-dots-wrap')?.classList.add('is-empty');
        return;
      }

      dotsWrap?.closest('.hero-dots-wrap')?.classList.remove('is-empty');
      btnPrev.hidden = false;               /* slides exist → controls return */
      btnNext.hidden = false;

      slides.forEach((s, n) => {
        const el = document.createElement('div');
        el.className = `hero-slide${n === 0 ? ' is-active' : ''}`;
        el.innerHTML = `<img src="${T.esc(s.image_url)}" alt="${T.esc(s.alt_text || 'Hero slide ' + (n + 1))}" loading="${n === 0 ? 'eager' : 'lazy'}">`;
        if (s.link_url) {
          el.style.cursor = 'pointer';
          el.title = 'Open ' + T.esc(s.link_url);
          el.addEventListener('click', () => { stop(); location.href = s.link_url; });
        }
        slidesWrap.appendChild(el);
      });

      slides.forEach((_, n) => {
        if (!dotsWrap) return;
        const b = document.createElement('button');
        b.className = `hero-dot${n === 0 ? ' is-active' : ''}`;
        b.setAttribute('aria-label', 'Show slide ' + (n + 1));
        b.type = 'button';
        b.addEventListener('click', () => { go(n); restart(); });
        dotsWrap.appendChild(b);
      });

      updateArrows();
    }

    function updateArrows() {
      const dots = dotsWrap ? qsa('.hero-dot', dotsWrap) : [];
      dots.forEach((d, n) => d.classList.toggle('is-active', n === index));
      slidesWrap.querySelectorAll('.hero-slide').forEach((s, n) => {
        s.classList.toggle('is-active', n === index);
        s.classList.remove('is-leaving');
      });

    }

    function go(i) {
      if (animating || slides.length <= 1) return;
      animating = true;
      const from = index;
      index = (i + slides.length) % slides.length;

      const leaving = slidesWrap.querySelectorAll('.hero-slide')[from];
      const entering = slidesWrap.querySelectorAll('.hero-slide')[index];
      if (leaving) leaving.classList.add('is-leaving');
      if (entering) entering.classList.add('is-active');

      setTimeout(() => {
        if (leaving) {
          leaving.classList.remove('is-active', 'is-leaving');
        }
        updateArrows();
        animating = false;
      }, 700);
    }

    function next() { if (index < slides.length - 1) go(index + 1); else go(0); }
    function prev() { if (index > 0) go(index - 1); else go(slides.length - 1); }

    function start() { stop(); timer = setInterval(next, AUTOPLAY_MS); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    btnPrev.addEventListener('click', () => { prev(); start(); });
    btnNext.addEventListener('click', () => { next(); start(); });

    /* pause autoplay on hover / interaction, resume when idle */
    hero.addEventListener('mouseenter', stop, { passive: true });
    hero.addEventListener('mouseleave', start, { passive: true });
    hero.addEventListener('keydown', start, { passive: true }); /* resume on keyboard nav */

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else start();
    });

    loadSlides().then(() => {
      updateArrows();
      if (slides.length) start();
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
    let p = await T.products.get(id);

    if (!p && id) {
      /* A transient Supabase hiccup must never bounce a real product to the
         shop: settle briefly, force one fresh catalog fetch, then decide. */
      await T.sleep(700);
      await T.products.loadOnce(true);
      p = await T.products.get(id);
    }

    const notFound = qs('#pdp-not-found');
    if (!p) {
      /* No valid product for this id — redirect to shop instead of showing
         an empty 0.00 DH template. Keeps the not-found block as a fallback
         for non-JS or direct-link scenarios. */
      window.location.href = SHOP_URL();
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

    /* Painter: crossfade the big photo (fade out → swap src → fade in when the
       new frame is decoded), keep the 1/N counter + thumb highlight in sync,
       and prefetch the neighbours so arrow/swipe navigation feels instant. */
    const paintMeta = () => {
      if (!multi) return;
      countEl.textContent = (gi + 1) + ' / ' + gallery.length;
      qsa('#pdp-thumbs .pdpt').forEach((t, k) => t.classList.toggle('is-on', k === gi));
    };
    const paint = (i) => {
      gi = i < 0 ? gallery.length - 1 : (i >= gallery.length ? 0 : i); // wrap-around
      const el = qs('#pdp-img');
      const next = gallery[gi];
      paintMeta();
      if (el.getAttribute('src') === next) return; // same frame — nothing to fade
      el.classList.add('is-swap');
      el.src = next;
      el.alt = p.name + ' — photo ' + (gi + 1) + ' of ' + gallery.length + (p.categoryName ? ` — ${p.categoryName}` : '');
      const swapIn = () => requestAnimationFrame(() => el.classList.remove('is-swap'));
      if (el.complete) swapIn();                                  // cached — soft fade-in
      else {
        el.addEventListener('load', swapIn, { once: true });      // network — fade in when decoded
        el.addEventListener('error', swapIn, { once: true });     // a dead URL must never leave the frame faded
      }
      if (multi) { // prefetch both neighbours
        [gi + 1, gi - 1].forEach((n) => {
          const im = new Image();
          im.decoding = 'async';
          im.src = gallery[(n + gallery.length) % gallery.length];
        });
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
    // swipe navigation inside the fullscreen viewer (mobile)
    let lbx = 0, lbSwiping = false;
    lbImg.addEventListener('pointerdown', (e) => { lbSwiping = true; lbx = e.clientX; });
    lbImg.addEventListener('pointerup', (e) => {
      if (!lbSwiping) return;
      lbSwiping = false;
      const dx = e.clientX - lbx;
      if (multi && Math.abs(dx) > 48) { paint(dx < 0 ? gi + 1 : gi - 1); lbSync(); }
    });
    lbImg.addEventListener('pointercancel', () => { lbSwiping = false; });
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
    else { badgeEl.hidden = true; }

    qs('#pdp-cat').textContent = p.categoryName || 'T-Shirts';
    qs('#pdp-title').textContent = p.name;
    qs('#pdp-desc').innerHTML = T.products.descHTML(
      p.description || 'The THE ORIGINAL FIT staple — premium quality, timeless design.'
    );
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
    const stockLine = qs('#pdp-stock');
    stockLine.classList.toggle('is-out', !(Number(p.stock) > 0));
    stockLine.textContent = p.stock > 0 ? 'In stock and ready to ship' : 'Out of stock';

    // sizes — chips follow what the product actually carries (0009): the six
    // canonical sizes for variant products, the product's own size ('One
    // Size', 0011) when it has no variants. Legacy products (no size rows)
    // keep every size following the product-level stock.
    const SIZE_LADDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    const sizeRows = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : null;
    const ownSizes = sizeRows ? sizeRows.filter((x) => !SIZE_LADDER.includes(x.size)) : [];
    const chipSizes = ownSizes.length ? ownSizes.map((x) => x.size) : SIZE_LADDER;
    const stockOf = (s) => sizeRows
      ? ((sizeRows.find((x) => x.size === s) || {}).stock || 0)
      : (Number(p.stock) || 0);
    const chipsWrap = qs('#pdp-sizes');
    chipsWrap.innerHTML = chipSizes.map((s) => {
      const st = stockOf(s);
      const out = st <= 0;
      return `<button type="button" class="chip${out ? ' is-out' : ''}" data-size="${T.esc(s)}" aria-pressed="false"${out ? ' disabled title="Out of stock"' : ''}>${T.esc(s)}</button>`;
    }).join('');

    let size = (chipSizes.find((s) => stockOf(s) > 0)) || null;
    const sizeHint = qs('#pdp-size-hint');

    const paintSizes = () => {
      qsa('#pdp-sizes .chip').forEach((c) => {
        c.classList.toggle('is-on', c.dataset.size === size);
        c.setAttribute('aria-pressed', String(c.dataset.size === size));
      });
      sizeHint.classList.toggle('is-out', !size);
      sizeHint.textContent = size
        ? (size === 'One Size' ? 'One size selected' : `Size ${size} selected`)
        : 'Out of stock';
    };
    chipsWrap.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip || chip.disabled) return;
      size = chip.dataset.size;
      paintSizes();
      clampQty();
    });

    // qty stepper clamps to the selected size's stock
    let qty = 1;
    const qtyEl = qs('#pdp-qty-val');
    const qtyCap = () => Math.max(1, Math.min(size ? stockOf(size) : 1, 99));
    const clampQty = () => { qty = Math.max(1, Math.min(qty, qtyCap())); };
    qs('#pdp-qty-dec').addEventListener('click', () => { qty = Math.max(1, qty - 1); qtyEl.textContent = qty; });
    qs('#pdp-qty-inc').addEventListener('click', () => { qty = Math.min(qtyCap(), qty + 1); qtyEl.textContent = qty; });

    paintSizes();
    clampQty();
    qtyEl.textContent = qty;

    qs('#pdp-add').addEventListener('click', () => {
      if (!size) { T.toast('This product is out of stock in every size.'); return; }
      const res = T.cart.add(p, size, qty);
      if (res === 'blocked') {
        T.toast(size === 'One Size' ? 'One Size is out of stock.' : `Size ${size} is out of stock.`);
        return;
      }
      if (res === 'clamped') T.toast('Limited stock — cart updated to what is available.');
      else T.toast(size === 'One Size' ? `${p.name} × ${qty} — added to cart.` : `${p.name} × ${qty} — added to cart (size ${size}).`);
      bumpCartCount();
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
