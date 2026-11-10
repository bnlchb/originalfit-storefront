/* ============================================================================
   test-desc.mjs — verifies the PDP description renderer (T.products.descHTML)
   Runs the REAL products.js source in a Node shim, so the tested logic is the
   exact code the browser executes. Add cases to CASES freely.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'src/js/products.js'), 'utf8');

/* browser globals shim — the same T.esc the browser gets from tools.js */
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
global.window = { TOF: { esc } };
eval(src);
const d = window.TOF.products.descHTML;

const CASES = {
  A_plainLines: '100% heavyweight cotton\n240 GSM premium fabric\nPre-shrunk and garment-dyed',
  B_bulletsAndBlank: 'Oversized street fit\n- Drop shoulders, twin-needle hems\n- Ribbed crew neckline\n - Brushed inner face\n\nBreathable all-season weight',
  C_windowsCRLF: 'Mens tall tee 2.0\r\n- Boxy fit true to size\r\n* Heavyweight jersey',
  D_blankEdges: '\n\n First line only \n\n',
  E_bulletsInterspersed: 'Line one\n- Bullet A\nLine two\n- Bullet B',
  F_markerNoSpace: 'Standards:\n-Premium cotton\n*Ribbed neck\n•Twin-needle',
  G_xss: 'Safe line\n<script>alert(1)</script> shrink 5%\n<img src=x>',
  H_bigDotBullets: 'PUMA basique\n\u26ab Tanger\n\u26ab Manches courtes',
  I_blankRuns: 'Fit notes\n- Boxy\n- True to size\n\n\nCare: cold wash',
  J_empty: '',
  K_fallbackText: 'The THE ORIGINAL FIT staple — premium quality, timeless design.',
};

let failed = 0;
for (const [name, input] of Object.entries(CASES)) {
  const html = d(input);
  console.log(`=== ${name} ===`);
  console.log(html.replace(/></g, '>\n<') + '\n');

  /* invariants every render must satisfy (if holdFast structure) */
  const rows = (html.match(/<p>/g) || []).length
    + (html.match(/<li>/g) || []).length;
  const lines = input.split(/\r\n|\r|\n/).map((l) => l.trim())
    .filter((l, i, a) => l && !((i === 0 || i === a.length - 1) && !l && true));
  const expectedRows = input.split(/\r\n|\r|\n/).map((l) => l.trim())
    .filter((l) => l && !/^[-*\u2022\u25cf\u26ab\u25cb\u25e6\u25aa\u00b7\u2023\u2043]\s*/.test(l)).length
    + input.split(/\r\n|\r|\n/).map((l) => l.trim())
      .filter((l) => /^[-*\u2022\u25cf\u26ab\u25cb\u25e6\u25aa\u00b7\u2023\u2043]\s*\S/.test(l)).length;
  if (rows !== expectedRows) {
    console.log(`    !! FAIL: rendered ${rows} content rows, expected ${expectedRows}\n`);
    failed++;
  }
}

console.log(failed ? `\n${failed} CASE(S) FAILED` : '\nALL DESCRIPTION CASES pass (every content line renders as its own row)');
if (failed) process.exit(1);

/* real-database fixtures (if present) — sanitised descriptions pulled from
   the live products table; nothing is rendered outside the same invariants */
const fixturesPath = path.join(root, 'tmp-desc-fixtures.json');
if (fs.existsSync(fixturesPath)) {
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8').replace(/^\uFEFF/, ''));
  let fixturesFailed = false;
  console.log('\n--- REAL DATABASE DESCRIPTIONS ---');
  for (const [key, desc] of Object.entries(fixtures)) {
    const rendered = d(desc);
    const rows = (rendered.match(/<p>/g) || []).length + (rendered.match(/<li>/g) || []).length;
    const spacers = (rendered.match(/desc-sp/g) || []).length;
    /* the renderer turns EVERY line into exactly one element: content → row,
       blank → paragraph break; leading/trailing blanks never survive */
    const ls = String(desc).split(/\r\n|\r|\n/).map((l) => l.trim());
    while (ls.length && !ls[0]) ls.shift();
    while (ls.length && !ls[ls.length - 1]) ls.pop();
    const ok = rows + spacers === ls.length;
    console.log(`${ok ? 'ok ' : '!! '} ${key}: ${ls.length} typed line(s) → ${rows} row(s)${spacers ? ` + ${spacers} break(s)` : ''}`);
    console.log('    input: ' + JSON.stringify(desc));
    console.log('    html:  ' + JSON.stringify(rendered) + '\n');
    if (!ok) fixturesFailed = true;
  }
  if (fixturesFailed) process.exit(1);
}
