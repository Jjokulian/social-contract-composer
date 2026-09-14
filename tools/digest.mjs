#!/usr/bin/env node
// Digesting the platform (server/digest.mjs): its services' logical units (picos) and functional units (nanos), each
// linked to the code that implements it, and the purposes each service serves.
//
//   node tools/digest.mjs services                 the services and their files
//   node tools/digest.mjs service <id> [--text]    a service's files and units: ids, forms, names, dependencies, and code
//   node tools/digest.mjs lookup "<words>" [kind]  picos, functional units and intents in both stores that resemble the
//                                                  words (kind: definition, clause or intent); look before proposing one
//   node tools/digest.mjs try <digest.json>        apply it to a throwaway copy of the platform's store: what it would add
//   node tools/digest.mjs apply <digest.json>      write a reconciled digest into the platform's store
import { readFileSync } from 'node:fs';
import { openStore, catalogue, DEFAULT_PATH, SYSTEM_PATH } from '../server/store.mjs';
import { lookup, serviceUnits, apply, tryApply } from '../server/digest.mjs';
import { latestById } from '../public/common.mjs';

const [command, arg, extra] = process.argv.slice(2);
const platform = () => catalogue(openStore(SYSTEM_PATH, { readonly: true }));

if (command === 'services') {
  const cat = platform();
  const latest = latestById(Object.values(cat.contracts));
  for (const c of [...latest.values()].filter(c => c.id.startsWith('service.') && c.status !== 'retired'))
    console.log(`${c.id.slice(8).padEnd(16)} ${c.title}\n${c.includes.map(i => `  ${cat.contracts[i.ref].title}`).join('\n')}`);
} else if (command === 'service' && arg) {
  const s = serviceUnits(platform(), arg);
  console.log(`# ${s.title} (${s.ref})`);
  for (const f of s.files) {
    console.log(`\n## ${f.path} (${f.ref})`);
    for (const u of f.units) {
      console.log(`- ${u.id}  [${u.form}${u.name ? ` ${u.name}` : ''}, ${u.lines} lines]${u.depends.length ? `  uses: ${u.depends.join(', ')}` : ''}`);
      if (extra === '--text') console.log(u.text.replace(/^/gm, '    '));
    }
  }
} else if (command === 'lookup' && arg) {
  const sources = [{ store: 'platform', cat: platform() }, { store: 'catalogue', cat: catalogue(openStore(DEFAULT_PATH, { readonly: true })) }];
  const found = lookup(sources, arg, { kind: extra ?? null });
  if (!found.length) console.log('Nothing resembles those words.');
  for (const f of found)
    console.log(`${f.score.toFixed(2)}  ${f.store.padEnd(9)} ${f.kind.padEnd(10)} ${f.ref}\n      ${f.words}${f.implementedBy ? `\n      implemented by: ${f.implementedBy.join(', ')}` : ''}`);
} else if (command === 'try' && arg) {
  try {
    const r = tryApply(openStore(SYSTEM_PATH, { readonly: true }), JSON.parse(readFileSync(arg, 'utf8')));
    console.log(`It applies. Services revised: ${r.services.join(', ') || 'none'}\nNew revisions by kind: ${JSON.stringify(r.revisions)}`);
  } catch (err) {
    console.error(`It does not apply: ${err.message}`);
    process.exit(1);
  }
} else if (command === 'apply' && arg) {
  const revised = apply(openStore(SYSTEM_PATH), JSON.parse(readFileSync(arg, 'utf8')));
  console.log(`Applied${revised.length ? `, into ${revised.length} service${revised.length === 1 ? '' : 's'}: ${revised.join(', ')}` : ''}. Now run: node tools/platform.mjs extract`);
} else {
  console.error('usage: node tools/digest.mjs services | service <id> [--text] | lookup "<words>" [kind] | try <digest.json> | apply <digest.json>');
  process.exit(2);
}
