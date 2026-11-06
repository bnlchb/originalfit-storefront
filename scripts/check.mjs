/* one-off integrity check: JS id/class usage vs HTML/CSS availability */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const pages = ['index.html','pages/shop.html','pages/product.html','pages/collections.html','pages/about.html','pages/contact.html','pages/login.html','pages/cart.html','pages/account.html'];
const jss = ['src/js/supabase.js','src/js/products.js','src/js/cart.js','src/js/wishlist.js','src/js/auth.js','src/js/search.js','src/js/main.js'];
const csss = ['src/css/style.css','src/css/responsive.css','src/css/animations.css'];

const jsAll = jss.map(p => readFileSync(join(ROOT,p),'utf8')).join('\n');
const cssAll = csss.map(p => existsSync(join(ROOT,p)) ? readFileSync(join(ROOT,p),'utf8') : '').join('\n');

// 1) ids referenced in JS
const ids = new Set();
for (const m of jsAll.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) ids.add(m[1]);
for (const m of jsAll.matchAll(/(?:qs|qsa|querySelector(?:All)?)\(\s*['"`]#([a-zA-Z][\w-]*)/g)) ids.add(m[1]);

const issues = [];
for (const page of pages) {
  const html = readFileSync(join(ROOT,page),'utf8');
  for (const id of ids) {
    if (!html.includes(`id="${id}"`)) {
      // it's ok if a page legitimately lacks it (script guards); flag relevant core ids only
      const core = /^(newsletter-form|toast-wrap|search-overlay|cart-drawer|drawer|site-header|cart-count|data-newsletter)/;
      if (core.test(id)) issues.push(`${page}: missing core id "${id}"`);
    }
  }
  // script order sanity
  const order = [...html.matchAll(/src="[^"]*\/(env|supabase|products|cart|wishlist|auth|search|main)\.js"/g)].map(m=>m[1]);
  const want = ['env','supabase','products','cart','wishlist','auth','search','main'];
  const got = want.filter(w=>order.includes(w));
  if (JSON.stringify(got) !== JSON.stringify(order)) issues.push(`${page}: script order ${order.join(',')} != expected`);
  // root homepage must carry data-base="pages/"; inner pages intentionally don't (same-dir links)
  const isRoot = page === 'index.html';
  if (isRoot && !/data-base="pages\/?"/.test(html)) issues.push(`${page}: missing data-base="pages/"`);
  if (!isRoot && !/data-page="/.test(html)) issues.push(`${page}: missing data-page`);
}

// 2) CSS classes referenced by JS
const classes = new Set();
for (const m of jsAll.matchAll(/classList\.(?:add|remove|toggle)\(\s*['"]([a-z][\w-]*)['"]/gi)) classes.add(m[1]);
for (const m of jsAll.matchAll(/\bclass="([^"]+)"/g)) {
  m[1].split(/\s+/).forEach((c) => { if (/^[a-z][\w-]*$/.test(c)) classes.add(c); });
}
const cssClassesSet = new Set();
for (const m of cssAll.matchAll(/\.([a-zA-Z][\w-]*)/g)) cssClassesSet.add(m[1]);
for (const c of classes) {
  if (!cssClassesSet.has(c)) issues.push(`CSS missing class .${c}`);
}

console.log(issues.length ? issues.map(s=>'⚠ ' + s).join('\n') : 'ALL STATIC CHECKS PASS');
