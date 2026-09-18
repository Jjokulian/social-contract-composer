// The composer server: a JSON API over the stores, plus the client in public/.
//
// Every route reads the catalogue of contracts, or with ?store=system the platform's own store, in the same structure.
//
//   GET  /api/config                         what this deployment can do (a static build has no /api, and the client degrades)
//   GET  /api/contracts                      latest revision of every contract
//   GET  /api/contracts/:ref/report          the composition report; ?society=<id>&p.<parameter-id>=<value> to explore
//   GET  /api/contracts/:ref/snapshot        everything in scope for the contract; public/evaluate.mjs turns it into a report
//   GET  /api/societies                      societies that have evaluations
//   GET  /api/nanos/:ref                     one nano revision
//   GET  /api/demesnes                       every demesne revision (millis implemented on coordinate spaces) and the spaces
//   GET  /api/spaces/:space/layering         the demesnes on a space, outermost first; ?at=<x>,<y> keeps those stacked at a point
//   POST /api/nanos, /api/contracts, /api/demesnes   append to the store (only with COMPOSER_ALLOW_WRITES=1)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, listContracts, catalogue, mergeCatalogues, describe, resolve, addNano, addContract, addDemesne, listDemesnes, StoreError,
         DEFAULT_PATH, KNOWLEDGE_PATH, SYSTEM_PATH } from './store.mjs';
import { report, snapshot } from './checks.mjs';
import { layering, stackAt, instant } from '../public/space.mjs';

const PORT = Number(process.env.PORT ?? 8800);
const HOST = process.env.HOST ?? '127.0.0.1';
const WRITES = process.env.COMPOSER_ALLOW_WRITES === '1';
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};

// The catalogue of contracts, the bodies of knowledge it refers to, and the platform's own structure, all in the same
// schema: read-only unless writes are on. The first two are one space to compose in (mergeCatalogues); the platform's
// stands on its own, since code is never composed into a milli.
const stores = {
  catalogue: openStore(DEFAULT_PATH, { readonly: !WRITES }),
  knowledge: openStore(KNOWLEDGE_PATH, { readonly: !WRITES }),
  system: openStore(SYSTEM_PATH, { readonly: !WRITES }),
};
const COMPOSED_WITH = { catalogue: ['catalogue', 'knowledge'], knowledge: ['catalogue', 'knowledge'], system: ['system'] };
const spaceFor = name => mergeCatalogues(...COMPOSED_WITH[name].map(s => catalogue(stores[s])));
const nameFor = query => {
  const name = query.get('store') ?? 'catalogue';
  if (!Object.hasOwn(stores, name)) throw new StoreError(`no store ${name}: use ${Object.keys(stores).join(' or ')}`, 404);
  return name;
};
const storeFor = query => stores[nameFor(query)];

const parameterOverrides = query =>
  Object.fromEntries([...query].filter(([key]) => key.startsWith('p.')).map(([key, value]) => [key.slice(2), value]));

// Each route runs against the store the request names.
const routes = [
  { method: 'GET', path: /^\/api\/config$/, run: () => ({ server: true, writes: WRITES, stores: Object.keys(stores) }) },
  { method: 'GET', path: /^\/api\/contracts$/, run: ({ db }) => listContracts(db) },
  // Reading one store lists what that store holds; composing reaches the whole space it composes in.
  { method: 'GET', path: /^\/api\/catalogue$/, run: ({ store }) => spaceFor(store) },
  { method: 'GET', path: /^\/api\/contracts\/([^/]+)\/report$/,
    run: ({ db, params: [ref], query, store }) =>
      report(db, ref, { society: query.get('society') || null, parameters: parameterOverrides(query), cat: spaceFor(store) }) },
  { method: 'GET', path: /^\/api\/contracts\/([^/]+)\/snapshot$/, run: ({ db, params: [ref], store }) => snapshot(db, ref, spaceFor(store)) },
  { method: 'GET', path: /^\/api\/societies$/, run: ({ db }) => db.prepare('SELECT id, label FROM society ORDER BY label').all() },
  { method: 'GET', path: /^\/api\/nanos\/([^/]+)$/, run: ({ db, params: [ref] }) => describe(db, resolve(db, ref)) },
  { method: 'GET', path: /^\/api\/demesnes$/, run: ({ db }) => listDemesnes(db) },
  { method: 'GET', path: /^\/api\/spaces\/([^/]+)\/layering$/, run: ({ db, params: [space], query }) => {
    const at = query.get('at') ? query.get('at').split(',').map(Number) : null;
    if (at && (at.length !== 2 || !at.every(Number.isFinite))) throw new StoreError('at takes two numbers, x and y: ?at=12.5,55.6', 400);
    const when = query.get('when') || null;
    if (when && !instant(when)) throw new StoreError('when takes a year, month or day: ?when=1789, ?when=1789-04-30, or ?when=-0323 for 323 BC', 400);
    const all = layering(listDemesnes(db).demesnes, space, { when });
    return at ? stackAt(all, at) : all;
  } },
  { method: 'POST', path: /^\/api\/nanos$/, writes: true, run: ({ db, body }) => addNano(db, body) },
  { method: 'POST', path: /^\/api\/contracts$/, writes: true, run: ({ db, body }) => addContract(db, body) },
  { method: 'POST', path: /^\/api\/demesnes$/, writes: true, run: ({ db, body }) => addDemesne(db, body) },
];

const send = (res, status, data) => {
  res.writeHead(status, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};

const readBody = req => new Promise((ok, fail) => {
  let data = '';
  req.on('data', chunk => {
    data += chunk;
    if (data.length > 1e6) { fail(new StoreError('request body is over 1 MB', 413)); req.destroy(); }   // stop reading it
  });
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
    send(res, req.method === 'POST' ? 201 : 200,
         route.run({ params, query: url.searchParams, body, db: storeFor(url.searchParams), store: nameFor(url.searchParams) }));
  } catch (err) {
    const status = err instanceof StoreError || err.status ? err.status
      : err instanceof SyntaxError || err instanceof URIError || String(err.code).startsWith('SQLITE_CONSTRAINT') ? 400   // a malformed body or address
      : 500;
    if (status === 500) console.error(err);
    send(res, status, { error: err.message });
  }
}).listen(PORT, HOST, () => console.log(`Composer running at http://${HOST}:${PORT}${WRITES ? ' (writes on)' : ''}`));
