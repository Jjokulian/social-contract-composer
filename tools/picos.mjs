#!/usr/bin/env node
// Write with picos: see which words refer to which picos, before and after you write text into the store.
//
//   node tools/picos.mjs list  [contract]            the picos a contract uses (every pico in the store, without one)
//   node tools/picos.mjs find  <contract> "<text>"   how new text would link, and look-alike words that would not
//   node tools/picos.mjs check <contract>            every link in the contract, unlinked look-alikes, ambiguous forms
//
// Matching is public/picos.mjs, the same code the viewer uses. `check` exits with 1 if two picos share a form.
import { openStore, catalogue, DEFAULT_PATH } from '../server/store.mjs';
import { report } from '../server/checks.mjs';
import { picoMatcher, nearMisses } from '../public/picos.mjs';

const [command, contract, text] = process.argv.slice(2);
const usage = () => {
  console.error('usage: node tools/picos.mjs list [contract] | find <contract> "<text>" | check <contract>');
  process.exit(2);
};
const db = openStore(DEFAULT_PATH, { readonly: true });
const picosOf = ref => Object.values(ref ? report(db, ref).nanos : catalogue(db).nanos).filter(n => n.kind === 'definition');

if (command === 'list') {
  for (const p of picosOf(contract))
    console.log(`${p.ref}\n  forms:   ${p.forms.map(f => `“${f}”`).join(', ')}\n  meaning: ${p.meaning}\n`);
} else if (command === 'find') {
  if (!contract || !text) usage();
  const m = picoMatcher(picosOf(contract));
  console.log(m.render(text, s => s, (s, p) => `[${s} → ${p.ref}]`));
  const misses = nearMisses(text, m);
  console.log(misses.length
    ? `\nLook-alikes that would not link (check the sense):\n${misses.map(x => `  “${x.word}” (like ${x.picos.join(', ')})`).join('\n')}`
    : '\nNo unlinked look-alikes.');
} else if (command === 'check') {
  if (!contract) usage();
  const r = report(db, contract);
  const m = picoMatcher(Object.values(r.nanos).filter(n => n.kind === 'definition'));
  const texts = [
    ...Object.values(r.nanos).flatMap(n => [n.statement, n.text, n.meaning].filter(Boolean).map(t => [n.ref, t])),
    ...Object.values(r.claims).map(c => [c.ref, c.rationale]),
  ];
  const linked = new Map(), misses = new Map();
  for (const [ref, t] of texts) {
    for (const x of m.find(t, ref)) {
      const words = linked.get(x.pico.ref) ?? new Map();
      words.set(x.text.toLowerCase(), (words.get(x.text.toLowerCase()) ?? 0) + 1);
      linked.set(x.pico.ref, words);
    }
    for (const x of nearMisses(t, m)) {
      const key = x.word.toLowerCase(), e = misses.get(key) ?? { n: 0, picos: x.picos, in: new Set() };
      e.n++; e.in.add(ref); misses.set(key, e);
    }
  }
  console.log(`${r.contract.ref}: ${m.picos.length} picos\n\nLinked words`);
  for (const [ref, words] of linked) console.log(`  ${ref.padEnd(44)} ${[...words].map(([w, n]) => `${w} ×${n}`).join(', ')}`);
  console.log('\nUnlinked look-alikes (check the sense: add a form, or leave unlinked on purpose)');
  if (!misses.size) console.log('  none');
  for (const [w, e] of [...misses].sort((a, b) => b[1].n - a[1].n))
    console.log(`  ${`${w} ×${e.n}`.padEnd(20)} like ${e.picos.join(', ')}   in ${[...e.in].slice(0, 3).join(', ')}${e.in.size > 3 ? ', …' : ''}`);
  console.log(`\nAmbiguous forms (one form in two picos): ${m.collisions.length
    ? m.collisions.map(c => `“${c.form}” in ${c.picos.join(' and ')}`).join('; ') : 'none'}`);
  if (m.collisions.length) process.exitCode = 1;
} else usage();
