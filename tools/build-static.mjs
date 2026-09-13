#!/usr/bin/env node
// Build the static site into dist/: the client, plus every contract's snapshot baked from the store.
// The server stays the primary way to run the composer; this is a second way to publish the same data.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openStore, listContracts, catalogue, DEFAULT_PATH } from '../server/store.mjs';
import { snapshot } from '../server/checks.mjs';

const OUT = new URL('../dist/', import.meta.url);
const db = openStore(DEFAULT_PATH, { readonly: true });

rmSync(OUT, { recursive: true, force: true });
cpSync(new URL('../public/', import.meta.url), OUT, { recursive: true });
mkdirSync(new URL('data/snapshots/', OUT), { recursive: true });
const write = (path, data) => writeFileSync(new URL(path, OUT), typeof data === 'string' ? data : JSON.stringify(data));

const contracts = listContracts(db);
write('data/contracts.json', contracts);
write('data/societies.json', db.prepare('SELECT id, label FROM society ORDER BY label').all());
for (const c of contracts) write(`data/snapshots/${c.id}.json`, snapshot(db, c.ref));
write('data/catalogue.json', catalogue(db));   // every nano and contract, for composing drafts in the browser
write('.nojekyll', '');   // serve every file as-is

// Hosts cache files for minutes (GitHub Pages: max-age=600). Stamp the scripts and stylesheet with a hash of
// their content, so a new deploy is never paired with a cached old script. Data is revalidated by the client.
const read = path => readFileSync(new URL(path, OUT), 'utf8');
const SCRIPTS = ['app.js', 'composer.js', 'compose.mjs', 'evaluate.mjs'];
const PAGES = ['index.html', 'guide.html', 'compose.html'];
const version = createHash('sha256').update([...SCRIPTS, 'style.css', ...PAGES].map(read).join('\0')).digest('hex').slice(0, 10);
for (const script of SCRIPTS)
  write(script, read(script).replace(/from '\.\/([a-z-]+\.mjs)'/g, `from './$1?v=${version}'`));
for (const page of PAGES)
  write(page, read(page)
    .replace('href="style.css"', `href="style.css?v=${version}"`)
    .replace(/src="([a-z-]+\.js)"/, `src="$1?v=${version}"`));

console.log(`Built dist/ (version ${version}) with ${contracts.length} contract snapshot${contracts.length === 1 ? '' : 's'}.`);
