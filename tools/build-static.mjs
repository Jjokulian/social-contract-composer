#!/usr/bin/env node
// Build the static site into dist/: the client, plus every contract's snapshot baked from the store.
// The server stays the primary way to run the composer; this is a second way to publish the same data.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { openStore, listContracts, DEFAULT_PATH } from '../server/store.mjs';
import { snapshot } from '../server/checks.mjs';

const OUT = new URL('../dist/', import.meta.url);
const db = openStore(DEFAULT_PATH, { readonly: true });

rmSync(OUT, { recursive: true, force: true });
cpSync(new URL('../public/', import.meta.url), OUT, { recursive: true });
mkdirSync(new URL('data/snapshots/', OUT), { recursive: true });
const write = (path, data) => writeFileSync(new URL(path, OUT), JSON.stringify(data));

const contracts = listContracts(db);
write('data/contracts.json', contracts);
write('data/societies.json', db.prepare('SELECT id, label FROM society ORDER BY label').all());
for (const c of contracts) write(`data/snapshots/${c.id}.json`, snapshot(db, c.ref));
writeFileSync(new URL('.nojekyll', OUT), '');   // serve every file as-is; Jekyll would skip nothing here, but it's slower

console.log(`Built dist/ with ${contracts.length} contract snapshot${contracts.length === 1 ? '' : 's'}.`);
