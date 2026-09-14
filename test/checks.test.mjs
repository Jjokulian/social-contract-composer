import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNano, addContract, addDemesne, catalogue } from '../server/store.mjs';
import { snapshot } from '../server/checks.mjs';
import { checkSegment } from '../public/space.mjs';
import { buildGraph, filterGraph, levelGraph } from '../public/levels.mjs';
import { buildFixture } from './fixture.mjs';

const ring = (...points) => [...points, points[0]];

test('a segment must be simple, its holes inside it, and on Earth within the globe', () => {
  assert.throws(() => checkSegment({ type: 'Polygon', coordinates: [ring([0, 0], [2, 2], [2, 0], [0, 2])] }), /crosses itself/);
  assert.throws(() => checkSegment({ type: 'Polygon', coordinates: [ring([0, 0], [4, 0], [4, 4], [0, 4]), ring([5, 5], [6, 5], [6, 6])] }), /hole lies outside/);
  assert.doesNotThrow(() => checkSegment({ type: 'Polygon', coordinates: [ring([0, 0], [4, 0], [4, 4], [0, 4]), ring([1, 1], [2, 1], [2, 2])] }));
  const { db } = buildFixture();
  const milli = addContract(db, { id: 'polar', scale: 'social', title: 'Polar', filedBy: 'planners', source: 'test' }).ref;
  assert.throws(() => addDemesne(db, { id: 'beyond', name: 'Beyond the pole', milli, space: 'earth', filedBy: 'planners', source: 'test',
    segment: { type: 'Polygon', coordinates: [ring([0, 89], [10, 89], [10, 95], [0, 95])] } }), /latitude within ±90°/);
});

test('lex specialis compares provisions, and a pico reference is a whole word', () => {
  const { db, refs, contracts } = buildFixture();
  assert.throws(() => addContract(db, { id: 'odd', scale: 'social', title: 'Odd', filedBy: 'planners', source: 'test',
    includes: [{ contract: contracts.streetTrees, mode: 'add' }], resolution: ['specialis'], specialis: [{ special: refs.shade, general: refs.safe }] }),
    /compares provisions/);
  assert.throws(() => addNano(db, { id: 'streetwise', kind: 'clause', role: 'council', modality: 'shall', text: 'Keep the streetwise trees.',
    picos: [{ phrase: 'street', pico: 'street-tree@1' }], filedBy: 'planners', source: 'test' }), /whole word/);
  assert.doesNotThrow(() => addNano(db, { id: 'the-trees', kind: 'clause', role: 'council', modality: 'shall', text: 'Keep the street tree’s crown clear.',
    picos: [{ phrase: 'street tree', pico: 'street-tree@1' }], filedBy: 'planners', source: 'test' }), 'a possessive may follow');
});

test('work is not repeated: one catalogue composes every snapshot, one built graph serves every filter', () => {
  const { db, contracts } = buildFixture();
  const cat = catalogue(db);
  assert.deepEqual(snapshot(db, contracts.town, cat), snapshot(db, contracts.town));
  const built = buildGraph(cat);
  for (const levels of [['milli', 'micro'], ['micro', 'pico'], ['nano']])
    assert.deepEqual(filterGraph(built, { levels }), levelGraph(cat, { levels }));
});

test('the levels graph draws evaluations, connected to the measure they observe', () => {
  const { db } = buildFixture();
  const g = levelGraph(catalogue(db));
  assert.ok(g.edges.some(e => e.kind === 'evaluates' && e.source === 'dryville-rain@1' && e.target === 'annual-rainfall@1'));
});
