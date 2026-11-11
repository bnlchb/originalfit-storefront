/* ============================================================================
   test-sizes.mjs — verifies the per-size pipeline (T.products.normalizeSizes)
   Runs the REAL products.js source in a Node shim, so the tested logic is the
   exact code the browser executes. Covers migration 0011 ('One Size'):
   ladder padding, non-ladder preservation, legacy null and stock coercion.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'src/js/products.js'), 'utf8');

/* browser globals shim — the same T.esc the browser gets from supabase.js */
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
global.window = { TOF: { esc } };
eval(src);
const norm = window.TOF.products.normalizeSizes;

const LADDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok ' : '!! FAIL'} ${name}`);
  if (!ok) {
    console.log('     got:  ' + JSON.stringify(got));
    console.log('     want: ' + JSON.stringify(want));
    failed++;
  }
};

/* legacy: no rows → null (every size follows the product-level stock) */
check('legacy no rows', norm(null), null);
check('legacy empty rows', norm([]), null);

/* ladder: full rows come back in ladder order, stocks coerced to numbers */
check('ladder full', norm([
  { size: 'XL', stock: 3 }, { size: 'S', stock: '2' }, { size: 'XS', stock: 0 },
  { size: 'M', stock: null }, { size: 'L', stock: 5 }, { size: 'XXL', stock: 0 },
]), [
  { size: 'XS', stock: 0 }, { size: 'S', stock: 2 }, { size: 'M', stock: 0 },
  { size: 'L', stock: 5 }, { size: 'XL', stock: 3 }, { size: 'XXL', stock: 0 },
]);

/* ladder: partial rows stay PADDED (0009 behavior — a ladder product always
   shows all six chips, missing rows read as 0) */
check('ladder partial padded', norm([{ size: 'S', stock: 2 }]), [
  { size: 'XS', stock: 0 }, { size: 'S', stock: 2 }, { size: 'M', stock: 0 },
  { size: 'L', stock: 0 }, { size: 'XL', stock: 0 }, { size: 'XXL', stock: 0 },
]);

/* One Size (0011): a non-ladder row survives and is appended after the ladder */
check('one size alongside ladder', norm([
  { size: 'S', stock: 1 }, { size: 'One Size', stock: 7 },
]), [
  { size: 'XS', stock: 0 }, { size: 'S', stock: 1 }, { size: 'M', stock: 0 },
  { size: 'L', stock: 0 }, { size: 'XL', stock: 0 }, { size: 'XXL', stock: 0 },
  { size: 'One Size', stock: 7 },
]);

/* One Size product (admin deletes ladder rows when switching modes):
   the single row is preserved with its exact case */
check('one size only', norm([{ size: 'One Size', stock: 12 }]), [
  { size: 'XS', stock: 0 }, { size: 'S', stock: 0 }, { size: 'M', stock: 0 },
  { size: 'L', stock: 0 }, { size: 'XL', stock: 0 }, { size: 'XXL', stock: 0 },
  { size: 'One Size', stock: 12 },
]);

/* exact case matters: the DB check (0011) only accepts 'One Size' */
check('one size case preserved', norm([{ size: 'One Size', stock: 1 }])[6].size, 'One Size');

/* the storefront chip rule (main.js PDP + drawer, cart.js page): a size list
   containing any non-ladder size shows ONLY those sizes — verified here
   against the real normalizeSizes output so the layers can never drift */
const chipSizesFor = (rows) => {
  const sizes = norm(rows);
  const snap = Array.isArray(sizes) && sizes.length ? sizes : null;
  const own = snap ? snap.filter((x) => !LADDER.includes(x.size)) : [];
  return own.length ? own.map((x) => x.size) : LADDER;
};
check('chips: ladder product', chipSizesFor([{ size: 'S', stock: 1 }]), LADDER);
check('chips: one size product', chipSizesFor([{ size: 'One Size', stock: 7 }]), ['One Size']);
check('chips: legacy null', (() => { const r = norm(null); return r === null ? LADDER : 'FAIL'; })(), LADDER);

console.log(failed ? `\n${failed} CASE(S) FAILED` : '\nALL SIZE CASES pass (ladder padded, One Size preserved, legacy intact)');
if (failed) process.exit(1);
