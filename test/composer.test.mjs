import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNano, addContract } from '../server/store.mjs';
import { report, snapshot, evaluate, jointlyImpossible } from '../server/checks.mjs';
import { buildFixture } from './fixture.mjs';

const pair = (r, a, b) => r.checks.disagreements.find(d => [d.a, d.b].sort().join() === [a, b].sort().join());
const find = (nodes, ref) => nodes.reduce((hit, n) => hit ?? (n.ref === ref ? n : find(n.children, ref)), undefined);

test('conditions on one quantity are impossible together only when their intervals are disjoint', () => {
  assert.equal(jointlyImpossible([{ op: '<=', value: 15 }, { op: '>', value: 15 }]), true);
  assert.equal(jointlyImpossible([{ op: '<', value: 5 }, { op: '>', value: 5 }]), true);
  assert.equal(jointlyImpossible([{ op: '>=', value: 8 }, { op: '<=', value: 8 }]), false);
  assert.equal(jointlyImpossible([{ op: '=', value: 3 }, { op: '>=', value: 3 }]), false);
  assert.equal(jointlyImpossible([{ op: '=', value: 3 }, { op: '=', value: 4 }]), true);
});

test('a snapshot round-tripped through JSON evaluates to the report the server gives', () => {
  const { db, contracts } = buildFixture();
  for (const ref of Object.values(contracts))
    for (const options of [{}, { parameters: { 'tree-spacing': 20 }, society: 'dryville' }])
      assert.deepEqual(evaluate(JSON.parse(JSON.stringify(snapshot(db, ref))), options), report(db, ref, options));
});

test('revisions are append-only', () => {
  const { db, refs } = buildFixture();
  assert.throws(() => db.prepare("UPDATE intent_body SET statement = 'changed'").run(), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM revision').run(), /immutable/);
  const next = addNano(db, { id: 'shade-walkers', kind: 'intent', filedBy: 'planners', source: 'test', statement: 'Shade for everyone outdoors' });
  assert.equal(next.ref, 'shade-walkers@2');
  assert.equal(refs.shade, 'shade-walkers@1');
});

test('the store rejects references of the wrong kind and rolls the whole write back', () => {
  const { db, refs } = buildFixture();
  assert.throws(() => addNano(db, { id: 'bad-claim', kind: 'claim', filedBy: 'critic', source: 'test',
    from: refs.shade, relation: 'supports', to: refs.safe, rationale: 'intent to intent' }), /wrong kinds/);
  assert.equal(db.prepare("SELECT COUNT(*) FROM nano WHERE id = 'bad-claim'").pluck().get(), 0);
  assert.throws(() => addContract(db, { id: 'too-sparse', scale: 'micro', title: 'x', filedBy: 'planners', source: 'test',
    parameters: { [refs.spacing]: 50 } }), /inside its domain/);
});

test('a micro-contract rolls its intents up and shows its own tension', () => {
  const { db, refs, contracts } = buildFixture();
  const r = report(db, contracts.streetTrees);
  const [root] = r.tree;
  assert.equal(root.ref, refs.greenStreets);
  assert.equal(root.coverage, 'claimed');
  assert.equal(find(r.tree, refs.safe).inTension, true);
  assert.deepEqual(r.checks.tensions, [{ clause: refs.plant, supports: [refs.shade], hinders: [refs.safe] }]);
  assert.deepEqual(r.checks.conflicts, [], 'the cable corridor is not part of this contract');
  assert.deepEqual(r.checks.orphans, []);
});

test('disagreements are classified by where their contexts part ways', () => {
  const { db, refs, contracts } = buildFixture();
  const r = report(db, contracts.streetTrees);
  assert.equal(pair(r, refs.shadeDense, refs.shadeSparse).kind, 'conditional');
  const crux = pair(r, refs.shadeWet, refs.shadeDry);
  assert.equal(crux.kind, 'crux-on-assumption');
  assert.deepEqual(crux.measureCruxes.map(m => m.quantity), ['annual-rainfall']);
  assert.equal(pair(r, refs.barrierHolds, refs.barrierHeaves).kind, 'direct');
  const divergent = pair(r, refs.rootsLift, refs.treesBuffer);
  assert.equal(divergent.kind, 'divergent-context');
  assert.deepEqual(divergent.when.onlyB, ['tree-spacing@1 >= 8']);
  assert.equal(pair(r, refs.shadeDense, refs.shadeWet), undefined, 'same conclusion is not a disagreement');
});

test('parameter choices and a society\'s evaluations change what applies', () => {
  const { db, refs, contracts } = buildFixture();
  const sparse = report(db, contracts.streetTrees, { parameters: { 'tree-spacing': 20 } });
  assert.equal(sparse.claims[refs.shadeDense].status, 'inactive');
  assert.equal(sparse.claims[refs.shadeWet].status, 'unverified');
  assert.equal(find(sparse.tree, refs.shade).coverage, 'claimed');

  const dry = report(db, contracts.streetTrees, { parameters: { 'tree-spacing': 20 }, society: 'dryville' });
  assert.equal(dry.claims[refs.shadeWet].status, 'contradicted');
  assert.equal(find(dry.tree, refs.shade).coverage, 'gap');
  assert.equal(dry.tree[0].coverage, 'gap', 'green streets needs all of its children');

  const wet = report(db, contracts.streetTrees, { society: 'wetton' });
  assert.equal(wet.claims[refs.shadeWet].status, 'applies');
  assert.throws(() => report(db, contracts.streetTrees, { parameters: { 'tree-spacing': 99 } }), /between 5 and 30/);
});

test('a social contract nests, adds, and surfaces clashes, conflicts, gaps and orphans', () => {
  const { db, refs, contracts } = buildFixture();
  const r = report(db, contracts.town);
  assert.deepEqual(r.tree.map(n => n.ref), [refs.livable, refs.power, refs.quiet]);
  assert.equal(r.tree[0].children[0].ref, refs.greenStreets, 'street-trees hangs under livable-town');
  assert.deepEqual(r.checks.definitionClashes, [{ term: 'street-tree', definitions: ['street-tree@1', 'street-tree-broad@1'] }]);
  assert.deepEqual(r.checks.conflicts, [{ claim: refs.treesVsCables, between: [refs.plant, refs.cables], endorsed: false }]);
  assert.deepEqual(r.checks.gaps, [refs.quiet]);
  assert.deepEqual(r.checks.orphans, [refs.party]);
});
