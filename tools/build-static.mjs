#!/usr/bin/env node
// Build the static site into dist/: the client, plus every contract's snapshot baked from the stores. The catalogue is
// baked into data/, the platform's own store into data/system/, in the same form, so a page reads either the same way.
// The server stays the primary way to run the composer; this is a second way to publish the same data.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openStore, listContracts, listDemesnes, catalogue, mergeCatalogues, DEFAULT_PATH, KNOWLEDGE_PATH, SYSTEM_PATH } from '../server/store.mjs';
import { snapshot } from '../server/checks.mjs';

const OUT = new URL('../dist/', import.meta.url);
const STORES = [['catalogue', DEFAULT_PATH, 'data/'], ['knowledge', KNOWLEDGE_PATH, 'data/knowledge/'],
                ['system', SYSTEM_PATH, 'data/system/']];   // named as ?store= names them

rmSync(OUT, { recursive: true, force: true });
cpSync(new URL('../public/', import.meta.url), OUT, { recursive: true });
const write = (path, data) => writeFileSync(new URL(path, OUT), typeof data === 'string' ? data : JSON.stringify(data));

const baked = [];
const opened = new Map(STORES.map(([name, path]) => [name, openStore(path, { readonly: true })]));
// A store lists what it holds, but composing reaches the whole space: the catalogue of social contracts and the bodies
// of knowledge are one space, so a milli reaches the knowledge it attaches; the platform's store stands on its own.
let composed = null;
const spaceFor = name => (name === 'system' ? catalogue(opened.get('system'))
  : (composed ??= mergeCatalogues(catalogue(opened.get('catalogue')), catalogue(opened.get('knowledge')))));

for (const [name, , dir] of STORES) {
  const db = opened.get(name);
  mkdirSync(new URL(`${dir}snapshots/`, OUT), { recursive: true });
  const contracts = listContracts(db);
  write(`${dir}contracts.json`, contracts);
  write(`${dir}societies.json`, db.prepare('SELECT id, label FROM society ORDER BY label').all());
  const space = spaceFor(name);   // built once: every snapshot composes from it, and it is published as it is
  for (const c of contracts) write(`${dir}snapshots/${c.id}.json`, snapshot(db, c.ref, space));
  write(`${dir}catalogue.json`, space);   // every nano and contract it may compose with, for composing drafts in the browser
  write(`${dir}demesnes.json`, listDemesnes(db)); // millis implemented on coordinate spaces; the browser computes the layers
  baked.push(`${contracts.length} ${name}`);
}
for (const db of opened.values()) db.close();
write('.nojekyll', '');   // serve every file as-is

// Hosts cache files for minutes (GitHub Pages: max-age=600). Stamp the scripts and stylesheet with a hash of
// their content, so a new deploy is never paired with a cached old script. Data is revalidated by the client.
const read = path => readFileSync(new URL(path, OUT), 'utf8');
const SCRIPTS = ['app.js', 'composer.js', 'graph.js', 'globe.js', 'time.js', 'levels.js', 'compose.mjs', 'evaluate.mjs', 'picos.mjs',
                 'source.mjs', 'explain.mjs', 'space.mjs', 'example-demesnes.mjs', 'levels.mjs', 'common.mjs', 'map.mjs', 'timeline.mjs', 'land.mjs'];
const PAGES = ['index.html', 'guide.html', 'compose.html', 'graph.html', 'globe.html', 'time.html', 'levels.html'];
const version = createHash('sha256').update([...SCRIPTS, 'style.css', ...PAGES].map(read).join('\0')).digest('hex').slice(0, 10);
for (const script of SCRIPTS)
  write(script, read(script).replace(/from '\.\/([a-z-]+\.mjs)'/g, `from './$1?v=${version}'`));
for (const page of PAGES)
  write(page, read(page)
    .replace('href="style.css"', `href="style.css?v=${version}"`)
    .replace(/src="([a-z-]+\.js)"/, `src="$1?v=${version}"`));

console.log(`Built dist/ (version ${version}) with contract snapshots: ${baked.join(', ')}.`);
