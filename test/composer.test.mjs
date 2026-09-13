import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNano, addContract, reviseContract, catalogue, addVocabulary } from '../server/store.mjs';
import { relinkContract } from '../server/relink.mjs';
import { report, snapshot, evaluate, compose, jointlyImpossible } from '../server/checks.mjs';
import { buildFixture } from './fixture.mjs';
import { picoMatcher, nearMisses } from '../public/picos.mjs';

test('picos link whole words, longest form first, never to themselves, and flag shared forms', () => {
  const mother = { ref: 'm@1', forms: ['mother thrives'] }, baby = { ref: 'b@1', forms: ['thrives', 'survive and thrive'] };
  const m = picoMatcher([mother, baby]);
  assert.deepEqual(m.find('The mother thrives; the baby thrives; thrivesome.').map(x => [x.text, x.pico.ref]),
    [['mother thrives', 'm@1'], ['thrives', 'b@1']]);
  assert.deepEqual(m.find('survive and thrive', 'b@1'), [], 'a pico’s own definition does not link to itself');
  assert.equal(m.render('The mother thrives.', s => s, (s, p) => `[${s}|${p.ref}]`), 'The [mother thrives|m@1].');
  assert.deepEqual(picoMatcher([mother, { ref: 'x@1', forms: ['Mother thrives'] }]).collisions, [{ form: 'mother thrives', picos: ['m@1', 'x@1'] }]);
  assert.deepEqual(nearMisses('She is thriving.', picoMatcher([{ ref: 'b@1', forms: ['baby thrives'] }])).map(x => x.word), ['thriving'],
    'a word sharing the stem of a form’s longest word, but not linked, is a look-alike');
  const s = picoMatcher([{ ref: 's@1', forms: ['signatory'] }]);
  assert.deepEqual(s.find('The signatory’s role; the signatory\'s seat; signatorys.').map(x => x.text), ['signatory', 'signatory'],
    'a possessive links its form; a longer word does not');
});

test('relinking records missing pico references by new revisions, and never detaches others’ claims', () => {
  const { db, refs, contracts } = buildFixture();
  addVocabulary(db, 'term', 'establishment', 'establishment period');
  addVocabulary(db, 'term', 'interval', 'spacing interval');
  const est = addNano(db, { id: 'establishment', kind: 'definition', filedBy: 'planners', source: 'test', term: 'establishment',
    meaning: 'The first three summers after planting.', forms: ['first three summers'] }).ref;
  const interval = addNano(db, { id: 'spacing-interval', kind: 'definition', filedBy: 'planners', source: 'test', term: 'interval',
    meaning: 'The distance set by the tree spacing parameter.', forms: ['spacing interval'] }).ref;
  const withPicos = reviseContract(db, contracts.streetTrees, { add: [est, interval], filedBy: 'planners', source: 'test' }).ref;
  const before = report(db, withPicos);

  const result = relinkContract(db, withPicos, { filedBy: 'planners', source: 'test relink' });
  const after = report(db, result.contract);
  const water2 = result.rewritten.find(([old]) => old === 'water-young-trees@1')[1];
  assert.deepEqual(after.nanos[water2].picos, [{ phrase: 'first three summers', pico: est }], 'the clause records the new reference');
  assert.equal(after.nanos[water2].text, before.nanos['water-young-trees@1'].text, 'its text is unchanged');
  const wet2 = result.rewritten.find(([old]) => old === refs.shadeWet)[1];
  assert.deepEqual(after.claims[wet2].given, [water2], 'the claim that depends on it follows the new revision');
  assert.equal(after.claims[wet2].filedBy, 'planners', 'a rewritten nano keeps its author');
  assert.ok(result.blocked.some(b => b.nano === refs.plant), 'plant-trees is left as is: a critic’s claims point at it');
  assert.deepEqual(after.nanos[refs.plant].picos, [{ phrase: 'street tree', pico: 'street-tree@1' }]);
  assert.ok(after.claims[refs.shadeSparse], 'the critic’s claims stay in scope');
  assert.equal(after.tree[0].coverage, before.tree[0].coverage, 'coverage is unchanged');
  assert.deepEqual(after.checks.staleReferences, []);
});

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

test('a draft composed in the browser is evaluated exactly like a stored contract', () => {
  const { db, refs, contracts } = buildFixture();
  const cat = JSON.parse(JSON.stringify(catalogue(db)));   // what the browser fetches
  const claim = { kind: 'claim', ref: 'draft-claim-1@1', id: 'draft-claim-1', rev: 1, rid: 1e9 + 1, from: refs.party, relation: 'supports',
    to: refs.livable, strength: 'contributes', rationale: 'Neighbours meet.', given: [], when: [], assuming: [], measuredBy: [], filedBy: 'you', source: 'draft' };
  const draft = { id: 'draft', scale: 'social', title: 'Draft', status: 'draft',
    intents: [{ ref: refs.livable, combine: 'all' }], edges: [], members: [refs.party, claim.ref], parameters: {},
    includes: [{ ref: contracts.streetTrees, mode: 'nest', under: refs.livable }],
    breaches: [{ clause: refs.plant, consequence: refs.fine }] };
  const r = evaluate(compose({ ...cat, nanos: { ...cat.nanos, [claim.ref]: claim } }, draft));
  assert.equal(r.tree[0].children[0].ref, refs.greenStreets, 'the nested contract hangs under the draft’s intent');
  assert.deepEqual(r.breaches[0], { clause: refs.plant, consequences: [refs.fine], setBy: '(draft)' });
  assert.equal(r.claims[claim.ref].endorsed, true);
  assert.ok(r.tree[0].supports.includes(claim.ref), 'the draft’s own claim counts towards its intent');
  const stored = report(db, contracts.town);
  assert.deepEqual(r.checks.definitionClashes, [], 'utilities is not in this draft, so no clash');
  assert.equal(stored.checks.definitionClashes.length, 1);
});

test('a nano’s picos are fixed when it is written: a newer or better pico never changes what it means', () => {
  const { db, refs, contracts } = buildFixture();
  const was = [{ phrase: 'street tree', pico: 'street-tree@1' }];
  assert.deepEqual(report(db, contracts.streetTrees).nanos[refs.plant].picos, was);
  assert.throws(() => addNano(db, { id: 'bad-ref', kind: 'intent', filedBy: 'planners', source: 'test', statement: 'Shade',
    picos: [{ phrase: 'street tree', pico: 'street-tree@1' }] }), /does not occur/);

  // A "better worked out" pico for the same words: the clause keeps its meaning, and the new sense shows as competing.
  const better = addNano(db, { id: 'street-tree-planting', kind: 'definition', filedBy: 'planners', source: 'test', term: 'street-tree',
    meaning: 'A tree the council planted in the right of way.', forms: ['a street tree', 'street tree'] }).ref;
  const withBetter = report(db, reviseContract(db, contracts.streetTrees, { add: [better], filedBy: 'planners', source: 'test' }).ref);
  assert.deepEqual(withBetter.nanos[refs.plant].picos, was, 'the clause still means what it meant');
  assert.ok(withBetter.checks.definitionClashes.some(c => c.kind === 'senses' && c.definitions.includes(better)));

  // A newer revision of the pico it uses: the clause keeps the older sense, shown as such until it is rewritten.
  const tree2 = addNano(db, { id: 'street-tree', kind: 'definition', filedBy: 'planners', source: 'test', term: 'street-tree',
    meaning: 'Any tree in the public right of way, planted or self-sown.' }).ref;
  const revised = report(db, reviseContract(db, contracts.streetTrees, { replace: { 'street-tree@1': tree2 }, filedBy: 'planners', source: 'test' }).ref);
  assert.deepEqual(revised.nanos[refs.plant].picos, was);
  assert.deepEqual(revised.checks.staleReferences, [{ nano: refs.plant, phrase: 'street tree', pico: 'street-tree@1', current: tree2 }]);
  assert.ok(revised.checks.definitionClashes.some(c => c.kind === 'versions'));
  assert.throws(() => db.prepare('DELETE FROM nano_pico').run(), /fixed with its revision/);
});

test('revisions are append-only', () => {
  const { db, refs } = buildFixture();
  assert.throws(() => db.prepare("UPDATE intent_body SET statement = 'changed'").run(), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM revision').run(), /immutable/);
  const next = addNano(db, { id: 'shade-walkers', kind: 'intent', filedBy: 'planners', source: 'test', statement: 'Shade for everyone outdoors' });
  assert.equal(next.ref, 'shade-walkers@2');
  assert.equal(refs.shade, 'shade-walkers@1');
});

test('revising a contract swaps pinned references and leaves claims about the old revision out of scope', () => {
  const { db, refs, contracts } = buildFixture();
  const plant2 = addNano(db, { id: 'plant-trees', kind: 'clause', filedBy: 'planners', source: 'test',
    role: 'council', modality: 'shall', text: 'Plant a native street tree at every spacing interval.' }).ref;
  const revised = reviseContract(db, contracts.streetTrees, { replace: { [refs.plant]: plant2 }, filedBy: 'planners', source: 'test' });
  assert.equal(revised.ref, 'street-trees@2');
  const r = report(db, revised.ref);
  assert.equal(r.tree[0].ref, refs.greenStreets);
  assert.deepEqual(r.parameters.map(p => [p.id, p.value]), [['tree-spacing', 10]]);
  assert.ok(r.nanos[plant2] && !r.nanos[refs.plant], 'the new clause revision replaces the old one');
  assert.equal(r.claims[refs.shadeDense], undefined, 'claims pinned to plant-trees@1 no longer apply');
  assert.ok(r.claims[refs.barrierHolds], 'claims about untouched clauses carry over');
  assert.deepEqual(report(db, contracts.town).tree[0].children[0].ref, refs.greenStreets, 'the town still pins street-trees@1');

  const moved = reviseContract(db, revised.ref, { dropEdges: [{ child: refs.safe, parent: refs.greenStreets }],
    addIntents: [{ ref: refs.safe, parent: refs.shade }], filedBy: 'planners', source: 'test' });
  const tree = report(db, moved.ref).tree;
  assert.deepEqual(tree[0].children.map(n => n.ref), [refs.shade], 'the dropped refinement is gone');
  assert.deepEqual(find(tree, refs.shade).children.map(n => n.ref), [refs.safe], 'an existing intent moves under a new parent');
});

test('the store rejects references of the wrong kind and rolls the whole write back', () => {
  const { db, refs } = buildFixture();
  assert.throws(() => addNano(db, { id: 'bad-claim', kind: 'claim', filedBy: 'critic', source: 'test',
    from: refs.shade, relation: 'supports', to: refs.safe, rationale: 'intent to intent' }), /wrong kinds/);
  assert.equal(db.prepare("SELECT COUNT(*) FROM nano WHERE id = 'bad-claim'").pluck().get(), 0);
  assert.throws(() => addContract(db, { id: 'too-sparse', scale: 'micro', title: 'x', filedBy: 'planners', source: 'test',
    parameters: { [refs.spacing]: 50 } }), /inside its domain/);
});

test('influences run from a measure, are in scope when both ends are, and never change coverage', () => {
  const { db, refs, contracts } = buildFixture();
  assert.throws(() => addNano(db, { id: 'bad-influence', kind: 'influence', filedBy: 'critic', source: 'test',
    from: refs.shade, direction: 'raises', to: refs.canopy, rationale: 'intent as a source' }), /from a measure/);
  const r = report(db, contracts.streetTrees);
  assert.deepEqual(r.influences, [refs.rainFeedsCanopy, refs.canopyShades]);
  assert.deepEqual(find(r.tree, refs.shade).influences, [refs.canopyShades]);
  assert.equal(r.nanos[refs.canopyShades].direction, 'bears-on');
  assert.equal(find(r.tree, refs.shade).coverage, 'claimed');
  assert.deepEqual(report(db, contracts.utilities).influences, [], 'rainfall and canopy are not part of utilities');
});

test('consequences of breach are set by the composition, and the outermost contract decides', () => {
  const { db, refs, contracts } = buildFixture();
  assert.deepEqual(report(db, contracts.streetTrees).breaches, [
    { clause: refs.plant, consequences: [refs.warning], setBy: contracts.streetTrees },
    { clause: refs.barriers, consequences: [refs.warning], setBy: contracts.streetTrees },
  ]);
  assert.deepEqual(report(db, contracts.town).breaches, [
    { clause: refs.plant, consequences: [refs.fine], setBy: contracts.town },
    { clause: refs.barriers, consequences: [refs.warning], setBy: contracts.streetTrees },
  ]);
  assert.equal(report(db, contracts.town).nanos[refs.fine].statement, 'A fine paid to the street fund');
  assert.throws(() => addContract(db, { id: 'bad-breach', scale: 'micro', title: 'x', filedBy: 'planners', source: 'test',
    members: [refs.plant], breaches: [{ clause: refs.plant, consequence: refs.shade }] }), /not a consequence/);
});

test('clauses bind to work, a rule or a liberty, and consequences need someone assigned to detect breaches', () => {
  const { db, refs, contracts } = buildFixture();
  const r = report(db, contracts.town);
  assert.equal(r.nanos[refs.plant].binding, 'work', 'shall follows the modality: work');
  assert.equal(r.nanos[refs.plant].bindingStated, false);
  assert.equal(r.nanos[refs.cables].binding, 'abide', 'a stated binding overrides the modality');
  assert.equal(r.nanos[refs.cables].bindingStated, true);
  assert.deepEqual(r.enforcement, [{ clause: refs.plant, by: ['council'], setBy: contracts.town }]);
  assert.equal(r.roles.council, 'The town council');
  assert.deepEqual(r.checks.unenforced, [refs.barriers], 'the barriers warning has no one to detect breaches');
  assert.throws(() => addContract(db, { id: 'bad-enforcer', scale: 'micro', title: 'x', filedBy: 'planners', source: 'test',
    members: [refs.plant], enforcement: [{ clause: refs.shade, by: 'council' }] }), /not a clause/);
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
  assert.equal(pair(r, refs.barriersHelp, refs.barrierHolds), undefined, 'a stronger claim with more context refines, not disagrees');
  assert.deepEqual(r.checks.refinements.find(x => x.weak === refs.barriersHelp),
    { weak: refs.barriersHelp, strong: refs.barrierHolds, from: refs.barriers, to: refs.safe, adds: [refs.barriers] });
  assert.ok(pair(r, refs.barriersHelp, refs.barrierHeaves), 'opposite conclusions still disagree');
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
  assert.equal(r.contract.territory, 'old-town@1', 'a milli is implemented on a territory revision');
  assert.equal(r.nanos['old-town@1'].name, 'The old town and its river banks');
  assert.deepEqual([r.nanos['old-town@1'].frame, r.nanos['old-town@1'].geometry.type], ['WGS84', 'Polygon']);
  assert.equal(report(db, contracts.streetTrees).contract.territory, null, 'a micro has none');
  assert.throws(() => addContract(db, { id: 'nowhere', scale: 'social', title: 'x', filedBy: 'planners', source: 'test', territory: refs.shade }),
    /not a territory/);
  assert.throws(() => addNano(db, { id: 'bad-land', kind: 'territory', filedBy: 'planners', source: 'test', name: 'x', frame: 'WGS84',
    geometry: { type: 'Line' } }), /GeoJSON/);
  assert.equal(r.tree[0].children[0].ref, refs.greenStreets, 'street-trees hangs under livable-town');
  assert.deepEqual(r.checks.definitionClashes, [{ term: 'street-tree', definitions: ['street-tree@1', 'street-tree-broad@1'], kind: 'senses' }]);
  assert.deepEqual(r.nanos['street-tree@1'].forms, ['street tree'], 'a pico with no stated forms is referred to by its term');
  assert.deepEqual(r.nanos['street-tree-broad@1'].forms, ['street tree', 'street trees'], 'stated forms are the words that refer to it');
  assert.deepEqual(r.checks.conflicts, [{ claim: refs.treesVsCables, between: [refs.plant, refs.cables], endorsed: false }]);
  assert.deepEqual(r.checks.gaps, [refs.quiet]);
  assert.deepEqual(r.checks.orphans, [refs.party]);
});
