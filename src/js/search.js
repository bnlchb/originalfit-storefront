/* ============================================================================
   THE ORIGINAL FIT — search.js
   Live product search overlay (header search icon) + shop query hand-off.
   ============================================================================ */
'use strict';

window.TOF = window.TOF || {};

(function searchModule(T) {
  function init() {
    const overlay = document.getElementById('search-overlay');
    if (!overlay) return;

    const input = document.querySelector('#search-input');
    const results = document.querySelector('#search-results');
    const closeBtn = document.querySelector('#search-close');

    let debounce;

    function open() {
      overlay.classList.add('is-open');
      document.body.classList.add('no-scroll');
      setTimeout(() => input && input.focus(), 60);
    }

    function close() {
      overlay.classList.remove('is-open');
      document.body.classList.remove('no-scroll');
      if (input) { input.value = ''; }
      if (results) { results.innerHTML = ''; results.hidden = true; }
    }

    document.querySelectorAll('[data-open-search]').forEach((b) => b.addEventListener('click', open));
    closeBtn && closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('is-open')) close();
    });

    if (!input) return;

    function renderResults(items, q) {
      if (!items.length) {
        results.innerHTML = `<p class="search-empty">No products found for “${T.esc(q)}”. Try “tee”, “hoodie”, “minimal”.</p>`;
      } else {
        results.innerHTML = items.map((p) => `
          <a class="search-item" href="${T.url('product.html?id=' + encodeURIComponent(p.id))}">
            <img src="${p.imageUrl}" alt="" loading="lazy">
            <span>
              <span class="si-name">${T.esc(p.name)}</span>
              <span class="si-cat">${T.esc(p.categoryName)}</span>
            </span>
            <span class="si-price">${T.money(p.price)}</span>
          </a>`).join('') +
          `<p class="search-more"><a class="link-arrow" href="${T.url('shop.html')}?q=${encodeURIComponent(q)}">View all results <span class="arrow">→</span></a></p>`;
      }
      results.hidden = false;
    }

    async function run(q) {
      if (String(q).trim().length < 2) {
        results.hidden = true;
        results.innerHTML = '';
        return;
      }
      const items = await T.products.search(q, 6);
      renderResults(items, q);
    }

    input.addEventListener('input', () => {
      clearTimeout(debounce);
      const q = input.value;
      debounce = setTimeout(() => run(q), 180);
    });

    document.querySelector('#search-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (q.length) location.href = T.url('shop.html') + '?q=' + encodeURIComponent(q);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.TOF);
