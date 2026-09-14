import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { openStore, catalogue, addNano, addVocabulary, SYSTEM_PATH } from '../server/store.mjs';
import { extract } from '../server/platform.mjs';
import { apply, lookup, serviceUnits } from '../server/digest.mjs';

const copyOfPlatform = () => {
  const db = new Database(openStore(SYSTEM_PATH, { readonly: true }).serialize());
  db.pragma('foreign_keys = ON');
  return db;
};
const latest = (cat, id) => Object.values(id.startsWith('service.') ? cat.contracts : cat.nanos).filter(x => x.id === id).sort((a, b) => b.rev - a.rev)[0];

test('a digest gives a service its purposes, functional units and logical units, linked to the code that implements them', () => {
  const db = copyOfPlatform();
  const relate = 'code.public.space.mjs.function-relate', locate = 'code.public.space.mjs.function-locate';
  assert.ok(serviceUnits(catalogue(db), 'demesnes').files.some(f => f.units.some(u => u.id === relate)));
  apply(db, {
    roles: [['platform', 'The platform: the software itself']],
    picos: [{ id: 'point-in-segment.composer', term: 'point-in-segment', label: 'point in segment', forms: ['locate'],
              meaning: 'Whether a point lies inside a segment, on its boundary, or outside it.', implementedBy: [locate] }],
    services: [{
      service: 'demesnes',
      intents: [{ id: 'demesnes.see-nesting', statement: 'A viewer sees which demesnes lie within which.' }],
      nanos: [{ id: 'demesnes.relate-segments', text: 'The platform shall relate two segments as within, overlapping, touching or disjoint.',
                implementedBy: [relate], serves: [{ intent: 'demesnes.see-nesting', strength: 'contributes', rationale: 'Nesting is computed from how segments relate.' }] }],
      picos: ['point-in-segment.composer'],
    }],
  });
  let cat = catalogue(db);
  const service = latest(cat, 'service.demesnes');
  assert.ok(service.members.some(m => m.startsWith('point-in-segment.composer@')), 'the service holds its logical unit');
  assert.ok(service.intents.some(i => i.ref.startsWith('demesnes.see-nesting@')), 'and its purpose');
  assert.deepEqual(latest(cat, 'demesnes.relate-segments').implementedBy, [relate], 'a functional unit records the code implementing it');
  assert.equal(lookup([{ store: 'platform', cat }], 'whether a point lies inside')[0].ref.split('@')[0], 'point-in-segment.composer');

  // The next extraction links the code that uses the pico's forms to it, and keeps what was digested into the service.
  assert.ok(extract(db).written > 0);
  cat = catalogue(db);
  assert.ok(latest(cat, relate).picos.some(p => p.pico.startsWith('point-in-segment.composer@')), 'relate uses locate: it uses the pico');
  assert.ok(latest(cat, 'service.demesnes').members.some(m => m.startsWith('demesnes.relate-segments@')), 'the digest survives the files changing');
  assert.equal(extract(db).written, 0, 'and extraction is still a fixed point');
});

test('a digest merges a near-copy into one shared definition, and drops code that only uses a pico', () => {
  const db = copyOfPlatform();
  const by = { filedBy: 'claude-draft', source: 'a test' };
  const copy = 'code.test.copy-of-esc', esc = 'code.public.common.mjs.const-esc', short = 'code.public.common.mjs.const-short';
  addNano(db, { id: copy, kind: 'unit', form: 'const', name: 'esc', language: 'javascript', text: 'const esc = s => String(s);\n', depends: [], ...by });
  addVocabulary(db, 'term', 'copied-helper', 'copied helper');
  addNano(db, { id: 'copied-helper.composer', kind: 'definition', term: 'copied-helper', meaning: 'A helper someone copied.', forms: ['copied helper'],
                implementedBy: [copy], ...by });

  assert.throws(() => apply(db, { merges: [[esc, short, 'both are current']] }), /still in a current file/, 'only code that is gone merges');
  assert.throws(() => apply(db, { merges: [[copy, esc]] }), /say why/, 'a merge is declared, so it says why');
  apply(db, { merges: [[copy, esc, 'one definition of esc']] });
  assert.deepEqual(latest(catalogue(db), 'copied-helper.composer').implementedBy, [esc], 'what named the copy follows it to the shared definition');

  assert.throws(() => apply(db, { picos: [{ id: 'copied-helper.composer', drop: [short] }] }), /not implemented by/);
  apply(db, { picos: [{ id: 'copied-helper.composer', drop: [esc], implementedBy: [short] }] });
  assert.deepEqual(latest(catalogue(db), 'copied-helper.composer').implementedBy, [short], 'code that only uses a pico drops out');
});
