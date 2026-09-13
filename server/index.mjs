// The composer server: a JSON API over the store, plus the client in public/.
//
//   GET  /api/config                         what this deployment can do (a static build has no /api, and the client degrades)
//   GET  /api/contracts                      latest revision of every contract
//   GET  /api/contracts/:ref/report          the composition report; ?society=<id>&p.<parameter-id>=<value> to explore
//   GET  /api/contracts/:ref/snapshot        everything in scope for the contract; public/evaluate.mjs turns it into a report
//   GET  /api/societies                      societies that have evaluations
//   GET  /api/nanos/:ref                     one nano revision
//   POST /api/nanos, /api/contracts          append to the store (only with COMPOSER_ALLOW_WRITES=1)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, listContracts, describe, resolve, addNano, addContract, StoreError } from './store.mjs';
import { report, snapshot } from './checks.mjs';

const PORT = Number(process.env.PORT ?? 8800);
const HOST = process.env.HOST ?? '127.0.0.1';
const WRITES = process.env.COMPOSER_ALLOW_WRITES === '1';
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};

const db = openStore();

const parameterOverrides = query =>
  Object.fromEntries([...query].filter(([key]) => key.startsWith('p.')).map(([key, value]) => [key.slice(2), value]));

const routes = [
  { method: 'GET', path: /^\/api\/config$/, run: () => ({ server: true, writes: WRITES }) },
  { method: 'GET', path: /^\/api\/contracts$/, run: () => listContracts(db) },
  { method: 'GET', path: /^\/api\/contracts\/([^/]+)\/report$/,
    run: ([ref], query) => report(db, ref, { society: query.get('society') || null, parameters: parameterOverrides(query) }) },
  { method: 'GET', path: /^\/api\/contracts\/([^/]+)\/snapshot$/, run: ([ref]) => snapshot(db, ref) },
  { method: 'GET', path: /^\/api\/societies$/, run: () => db.prepare('SELECT id, label FROM society ORDER BY label').all() },
  { method: 'GET', path: /^\/api\/nanos\/([^/]+)$/, run: ([ref]) => describe(db, resolve(db, ref)) },
  { method: 'POST', path: /^\/api\/nanos$/, writes: true, run: (_, __, body) => addNano(db, body) },
  { method: 'POST', path: /^\/api\/contracts$/, writes: true, run: (_, __, body) => addContract(db, body) },
];

const send = (res, status, data) => {
  res.writeHead(status, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};

const readBody = req => new Promise((ok, fail) => {
  let data = '';
  req.on('data', chunk => { data += chunk; if (data.length > 1e6) fail(new StoreError('request body is over 1 MB', 413)); });
  req.on('end', () => ok(data));
  req.on('error', fail);
});

async function serveStatic(pathname, res) {
  const file = normalize(join(PUBLIC, pathname === '/' ? 'index.html' : decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'outside the public directory' });
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(content);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return send(res, 404, { error: `no file ${pathname}` });
    throw err;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (!url.pathname.startsWith('/api/')) return await serveStatic(url.pathname, res);
    const route = routes.find(r => r.method === req.method && r.path.test(url.pathname));
    if (!route) return send(res, 404, { error: `no route ${req.method} ${url.pathname}` });
    if (route.writes && !WRITES) return send(res, 403, { error: 'Writes are off. Start the server with COMPOSER_ALLOW_WRITES=1 to allow them.' });
    const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : null;
    const params = route.path.exec(url.pathname).slice(1).map(decodeURIComponent);
    send(res, req.method === 'POST' ? 201 : 200, route.run(params, url.searchParams, body));
  } catch (err) {
    const status = err instanceof StoreError || err.status ? err.status
      : err instanceof SyntaxError || String(err.code).startsWith('SQLITE_CONSTRAINT') ? 400
      : 500;
    if (status === 500) console.error(err);
    send(res, status, { error: err.message });
  }
}).listen(PORT, HOST, () => console.log(`Composer running at http://${HOST}:${PORT}${WRITES ? ' (writes on)' : ''}`));
