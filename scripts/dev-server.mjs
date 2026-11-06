#!/usr/bin/env node
/**
 * THE ORIGINAL FIT — zero-dependency dev server.
 * Serves the static site on http://localhost:5173
 * and exposes `GET /__/env.json` (read from `.env`) so the
 * browser can obtain the public Supabase URL + anon key without
 * hard-coding them into HTML/CSS/JS.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, parse as parseUrl } from 'node:url'; // parse unused, keep url import minimal

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Read .env into a flat object (no dependencies). */
function readEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);

    // Public-safe env endpoint (values come from .env, never hard-coded)
    if (pathname === '/__/env.json') {
      const env = readEnv();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ SUPABASE_URL: env.SUPABASE_URL || '', SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY || '' }));
      return;
    }

    if (pathname.endsWith('/')) pathname += 'index.html';
    // Resolve inside ROOT only (block traversal)
    const rel = normalize(pathname).replace(/^([.][.][\\/])+/, '');
    const abs = join(ROOT, rel);
    if (!abs.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    // Friendly placeholder for the git-ignored generated env file
    if (abs.endsWith(join('src', 'js', 'env.js')) && !existsSync(abs)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('/* src/js/env.js not generated yet — dev server supplies /__/env.json instead. Run `npm run env:sync` for static hosting. */');
      return;
    }

    const body = await readFile(abs);
    res.writeHead(200, {
      'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — Not found');
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  THE ORIGINAL FIT — dev server');
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log('  Press Ctrl+C to stop');
  console.log('');
});
