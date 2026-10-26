// Minimal static file server for local development and Playwright.
// Usage: node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// LIBRARY_DIR serves another folder at /library/ (used by the browser tests).
const libraryRoot = process.env.LIBRARY_DIR ? resolve(process.env.LIBRARY_DIR) + sep : null;
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const rel = path.endsWith('/') ? `${path}index.html` : path;
  const base = libraryRoot && rel.startsWith('/library/') ? libraryRoot : root;
  const file = normalize(join(base, base === libraryRoot ? rel.slice('/library/'.length) : rel));
  if (!file.startsWith(base) || file.split(sep).includes('node_modules') || file.split(sep).includes('.git')) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Serving on http://127.0.0.1:${port}`));
