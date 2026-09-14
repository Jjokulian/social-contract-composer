#!/usr/bin/env node
// The composer's vocabulary is kept as picos in store/system.sqlite and rendered into the guide's glossary.
// To change a word, write a new revision of its pico (then relink with COMPOSER_STORE=system node tools/picos.mjs relink
// vocabulary), and render. Never edit the glossary in the guide by hand.
//
//   node tools/vocabulary.mjs render   rewrite the guide's glossary from the picos
//   node tools/vocabulary.mjs check    exit 1 if the guide's glossary is not what the picos render
import { readFileSync, writeFileSync } from 'node:fs';
import { openStore, SYSTEM_PATH } from '../server/store.mjs';
import { GUIDE, syncedGuide } from '../server/vocabulary.mjs';

const [command] = process.argv.slice(2);
const db = openStore(SYSTEM_PATH, { readonly: true });
const current = readFileSync(GUIDE, 'utf8');
const synced = syncedGuide(db, current);

if (command === 'render') {
  writeFileSync(GUIDE, synced);
  console.log(synced === current ? 'The glossary was already up to date.' : 'Rendered the glossary into public/guide.html.');
} else if (command === 'check') {
  if (synced !== current) {
    console.error('The guide’s glossary differs from the vocabulary picos. Run: node tools/vocabulary.mjs render');
    process.exit(1);
  }
  console.log('The guide’s glossary matches the vocabulary picos.');
} else {
  console.error('usage: node tools/vocabulary.mjs render | check');
  process.exit(2);
}
