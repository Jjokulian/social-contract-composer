import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore, listContracts, SYSTEM_PATH } from '../server/store.mjs';
import { report } from '../server/checks.mjs';
import { GUIDE, syncedGuide } from '../server/vocabulary.mjs';

test('the guide’s glossary is rendered from the composer’s own picos, which define each word once', () => {
  const db = openStore(SYSTEM_PATH, { readonly: true });
  assert.equal(readFileSync(GUIDE, 'utf8'), syncedGuide(db), 'the glossary was edited by hand, or the picos changed: run node tools/vocabulary.mjs render');
  const vocabulary = listContracts(db).find(c => c.id === 'vocabulary');
  const r = report(db, vocabulary.ref);
  assert.deepEqual(r.checks.definitionClashes.filter(d => d.kind === 'senses'), [], 'no word has two senses in the vocabulary');
  // Definitions refer to one another in cycles, so some references stay at an earlier revision (see server/vocabulary.mjs).
  // What must hold is that every word a meaning links to is defined in the vocabulary itself.
  const defined = new Set(Object.values(r.nanos).filter(n => n.kind === 'definition').map(n => n.id));
  const members = r.contract && Object.values(r.nanos).filter(n => n.kind === 'definition');
  for (const p of members) for (const { pico } of p.picos) assert.ok(defined.has(pico.split('@')[0]), `${p.ref} links to ${pico}, which the vocabulary doesn’t define`);
});
