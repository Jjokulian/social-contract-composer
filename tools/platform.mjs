#!/usr/bin/env node
// The platform as data (server/platform.mjs): the repository's source, unit by unit, in the platform's own store.
//
//   node tools/platform.mjs extract          write new revisions for whatever changed; a second run writes nothing
//   node tools/platform.mjs check            exit 1 unless every file rebuilt from the store equals the working tree
//   node tools/platform.mjs rebuild <dir>    write every file, rebuilt from the store, under <dir>
//
// Run extract before committing; the tests fail if the store and the working tree differ.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openStore, SYSTEM_PATH } from '../server/store.mjs';
import { extract, compare, rebuild } from '../server/platform.mjs';

const [command, dir] = process.argv.slice(2);

if (command === 'extract') {
  const r = extract(openStore(SYSTEM_PATH));
  console.log(`${r.files} files, ${r.units} units: ${r.written ? `wrote ${r.written} new revision${r.written === 1 ? '' : 's'}` : 'nothing changed'}.`);
} else if (command === 'check') {
  const { missing, stale, mismatched } = compare(openStore(SYSTEM_PATH, { readonly: true }));
  for (const [label, list] of [['not in the store', missing], ['gone from the working tree', stale], ['differ from the store', mismatched]])
    if (list.length) console.error(`Files ${label}:\n${list.map(p => `  ${p}`).join('\n')}`);
  if (missing.length || stale.length || mismatched.length) {
    console.error('Run: node tools/platform.mjs extract');
    process.exit(1);
  }
  console.log('Every file rebuilt from the platform’s store equals the working tree.');
} else if (command === 'rebuild' && dir) {
  const files = rebuild(openStore(SYSTEM_PATH, { readonly: true }));
  for (const [path, text] of files) {
    const out = join(resolve(dir), path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
  }
  console.log(`Rebuilt ${files.size} files under ${resolve(dir)}.`);
} else {
  console.error('usage: node tools/platform.mjs extract | check | rebuild <dir>');
  process.exit(2);
}
