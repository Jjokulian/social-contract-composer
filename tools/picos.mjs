#!/usr/bin/env node
// Write with picos. A nano's references to picos are recorded when it is written and never change; forms only suggest them.
//
//   node tools/picos.mjs list    [contract]            the picos a contract defines (every pico in the store, without one)
//   node tools/picos.mjs suggest <contract> "<text>"   the references to record for new text: pass them as `picos` to addNano
//   node tools/picos.mjs check   <contract>            recorded references, different revisions in use, suggestions not recorded,
//                                                      look-alikes, and forms shared by two picos (exits 1 on any)
//   node tools/picos.mjs relink  <contract> [author]   write new revisions so every nano records the references its picos
//                                                      suggest; text never changes; others' claims are never detached
//
// COMPOSER_STORE=system runs any of these on the platform's own store (store/system.sqlite) instead of the catalogue.
import { openStore, catalogue, TEXT_FIELD, DEFAULT_PATH, SYSTEM_PATH } from '../server/store.mjs';
import { report } from '../server/checks.mjs';
import { relinkContract } from '../server/relink.mjs';
import { picoMatcher, suggest, nearMisses } from '../public/picos.mjs';
import { latestById } from '../public/common.mjs';

const [command, contract, text] = process.argv.slice(2);
const usage = () => {
  console.error('usage: node tools/picos.mjs list [contract] | suggest <contract> "<text>" | check <contract> | relink <contract> [author]');
  process.exit(2);
};
const db = openStore(process.env.COMPOSER_STORE === 'system' ? SYSTEM_PATH : DEFAULT_PATH, { readonly: command !== 'relink' });

// The picos a composition defines: its definitions, at the revision the composition includes.
const definedPicos = r => [...latestById(Object.values(r.nanos).filter(n => n.kind === 'definition')).values()];

if (command === 'list') {
  const picos = contract ? definedPicos(report(db, contract)) : Object.values(catalogue(db).nanos).filter(n => n.kind === 'definition');
  for (const p of picos) console.log(`${p.ref}\n  forms:   ${p.forms.map(f => `“${f}”`).join(', ')}\n  meaning: ${p.meaning}\n`);
} else if (command === 'suggest') {
  if (!contract || !text) usage();
  const picos = definedPicos(report(db, contract));
  const m = picoMatcher(picos);
  console.log(m.render(text, s => s, (s, p) => `[${s} → ${p.ref}]`));
  console.log(`\nRecord with the nano:\n  picos: ${JSON.stringify(suggest(text, picos))}`);
  const misses = nearMisses(text, m);
  if (misses.length) console.log(`\nLook-alikes not suggested (check the sense):\n${misses.map(x => `  “${x.word}” (like ${x.picos.join(', ')})`).join('\n')}`);
} else if (command === 'check') {
  if (!contract) usage();
  const r = report(db, contract);
  const picos = definedPicos(r), m = picoMatcher(picos);
  const nanos = [...Object.values(r.nanos), ...Object.values(r.claims)].filter((n, i, all) => all.findIndex(x => x.ref === n.ref) === i);
  const recorded = new Map(), unrecorded = [], looks = new Map();
  for (const n of nanos) {
    const words = n[TEXT_FIELD[n.kind]];
    if (!words) continue;
    for (const p of n.picos ?? []) recorded.set(p.pico, [...(recorded.get(p.pico) ?? []), p.phrase.toLowerCase()]);
    for (const s of suggest(words, picos, n.ref))
      if (!(n.picos ?? []).some(p => p.phrase.toLowerCase() === s.phrase.toLowerCase())) unrecorded.push({ nano: n.ref, ...s });
    for (const x of nearMisses(words, m)) {
      if ((n.picos ?? []).some(p => p.phrase.toLowerCase().includes(x.word.toLowerCase()))) continue;
      const e = looks.get(x.word.toLowerCase()) ?? { n: 0, picos: x.picos }; e.n++; looks.set(x.word.toLowerCase(), e);
    }
  }
  console.log(`${r.contract.ref}: ${picos.length} picos defined\n\nRecorded references`);
  for (const [pico, phrases] of recorded) {
    const counts = phrases.reduce((a, p) => a.set(p, (a.get(p) ?? 0) + 1), new Map());
    console.log(`  ${pico.padEnd(44)} ${[...counts].map(([p, n]) => `${p} ×${n}`).join(', ')}`);
  }
  const stale = r.checks.staleReferences, clashes = r.checks.definitionClashes.filter(c => c.kind === 'senses');
  console.log(`\nDifferent revisions in use (rewrite the nano as a new revision to adopt the contract's): ${stale.length ? '' : 'none'}`);
  for (const s of stale) console.log(`  ${s.nano}: “${s.phrase}” means ${s.pico}; the contract defines ${s.current}`);
  console.log(`\nCompeting senses of one term: ${clashes.length ? clashes.map(c => `“${c.term}”: ${c.definitions.join(' and ')}`).join('; ') : 'none'}`);
  console.log(`\nSuggested but not recorded (to adopt, write a new revision of the nano): ${unrecorded.length ? '' : 'none'}`);
  for (const u of unrecorded) console.log(`  ${u.nano}: “${u.phrase}” → ${u.pico}`);
  console.log('\nUnlinked look-alikes (check the sense)');
  if (!looks.size) console.log('  none');
  for (const [w, e] of [...looks].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${`${w} ×${e.n}`.padEnd(20)} like ${e.picos.join(', ')}`);
  console.log(`\nForms shared by two picos: ${m.collisions.length ? m.collisions.map(c => `“${c.form}” in ${c.picos.join(' and ')}`).join('; ') : 'none'}`);
  if (m.collisions.length || stale.length || clashes.length) process.exitCode = 1;
} else if (command === 'relink') {
  if (!contract) usage();
  const author = text ?? 'claude-draft';
  const result = relinkContract(db, contract, { filedBy: author, source: `relinked to its picos by ${author}` });
  console.log(result.contract ? `Appended ${result.contract}` : 'Nothing to relink.');
  for (const [from, to] of result.rewritten) console.log(`  ${from} → ${to}`);
  for (const b of result.blocked) console.log(`  left as is: ${b.nano} (other claims point at it: ${b.by.join(', ')})`);
} else usage();
