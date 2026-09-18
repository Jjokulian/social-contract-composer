import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addNano, addContract, reviseContract, catalogue, addVocabulary, addDemesne, listContracts, openStore,
         mergeCatalogues } from '../server/store.mjs';
import { layering, stackAt, layersOf, paint, relate, instant } from '../public/space.mjs';
import { EXAMPLE } from '../public/example-demesnes.mjs';
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
  assert.equal(r.tree[0].children[0].ref, refs.greenStreets, 'street-trees hangs under livable-town');
  assert.deepEqual(r.checks.definitionClashes, [{ term: 'street-tree', definitions: ['street-tree@1', 'street-tree-broad@1'], kind: 'senses', resolution: null }]);
  assert.deepEqual(r.nanos['street-tree@1'].forms, ['street tree'], 'a pico with no stated forms is referred to by its term');
  assert.deepEqual(r.nanos['street-tree-broad@1'].forms, ['street tree', 'street trees'], 'stated forms are the words that refer to it');
  assert.deepEqual(r.checks.conflicts, [{ claim: refs.treesVsCables, between: [refs.plant, refs.cables], endorsed: false, resolution: null }]);
  assert.deepEqual(r.checks.gaps, [refs.quiet]);
  assert.deepEqual(r.checks.orphans, [refs.party]);
});

test('a composition follows declared rules: the order of includes never matters, and the contract with precedence decides', () => {
  const { db, refs, contracts } = buildFixture();
  const add = (id, scale, body) => addContract(db, { id, scale, title: id, filedBy: 'planners', source: 'test', ...body }).ref;
  const body = snap => JSON.stringify({ ...snap, contract: null });
  const includes = list => list.map(contract => ({ contract, mode: 'add' }));

  // An abrogation takes effect whatever the order: the repealer, composed later, has precedence over what it repeals.
  const repealer = add('repealer', 'micro', { operations: [{ op: 'abrogate', contract: contracts.utilities }] });
  const ab = snapshot(db, add('ab', 'social', { includes: includes([contracts.utilities, repealer]) }));
  const ba = snapshot(db, add('ba', 'social', { includes: includes([repealer, contracts.utilities]) }));
  assert.equal(body(ab), body(ba), 'the same composition, whatever the order of its includes');
  assert.ok(!ab.intents.some(i => i.ref === refs.power), 'utilities is abrogated');

  // Every permutation of a larger composition gives one snapshot.
  const three = [contracts.streetTrees, contracts.utilities, repealer];
  const snaps = [[0, 1, 2], [2, 0, 1], [1, 2, 0], [2, 1, 0]].map((p, k) => body(snapshot(db, add(`perm-${k}`, 'social', { includes: includes(p.map(i => three[i])) }))));
  assert.ok(snaps.every(s => s === snaps[0]), 'no permutation of the includes changes the snapshot');

  // An included contract's operator cannot undo the composition's own.
  const keeper = add('keeper', 'micro', { operations: [{ op: 'subrogate', contract: contracts.streetTrees, nano: refs.party }] });
  const derogating = add('derogating', 'social', { includes: includes([contracts.streetTrees, keeper]), operations: [{ op: 'derogate', nano: refs.party }] });
  assert.ok(!snapshot(db, derogating).clauses.includes(refs.party), 'the composition derogates what an included contract subrogates');

  // At one depth, ties are broken one way everywhere: the later-composed decides parameters and consequences alike.
  const early = add('early', 'micro', { members: [refs.plant], parameters: { [refs.spacing]: 12 }, breaches: [{ clause: refs.plant, consequence: refs.warning }] });
  const late = add('late', 'micro', { members: [refs.plant], parameters: { [refs.spacing]: 20 }, breaches: [{ clause: refs.plant, consequence: refs.fine }] });
  const tie = snapshot(db, add('tie', 'social', { includes: includes([early, late]) }));
  assert.equal(tie.parameters.find(p => p.ref === refs.spacing).value, 20, 'the later-composed sets the parameter');
  assert.deepEqual(tie.breaches.find(b => b.clause === refs.plant).consequences, [refs.fine], 'and the consequences, the same way');
});

test('operators act on what a composition includes, and its maxims resolve the conflicts that remain', () => {
  const { db, refs, contracts } = buildFixture();
  const milli = (id, body) => addContract(db, { id, scale: 'social', title: id, filedBy: 'planners', source: 'test', ...body }).ref;
  const both = (base = false) => [{ contract: contracts.streetTrees, mode: 'add', base }, { contract: contracts.utilities, mode: 'add' }];

  // Planting at every interval conflicts with the cable corridor. With no maxims, the conflict stays open and both stand.
  let r = report(db, milli('open', { includes: both() }));
  assert.equal(r.checks.conflicts[0].resolution, null);
  assert.equal(find(r.tree, refs.power).coverage, 'claimed');

  // Lex superior: the base outranks, and the side that loses is set aside, so its claims stop counting.
  r = report(db, milli('base-trees', { includes: both(true), resolution: ['superior'] }));
  assert.deepEqual(r.checks.conflicts[0].resolution, { prevails: refs.plant, setAside: refs.cables, by: 'superior' });
  assert.equal(find(r.tree, refs.power).coverage, 'gap', 'the set-aside corridor no longer keeps the power on');
  assert.deepEqual(r.checks.setAside, [refs.cables]);
  assert.ok(!r.checks.orphans.includes(refs.cables), 'a set-aside clause is shown under its conflict, not as an orphan');

  // Lex posterior: utilities was composed after street-trees, so its corridor prevails.
  assert.equal(report(db, milli('later-wins', { includes: both(), resolution: ['posterior'] })).checks.conflicts[0].resolution.prevails, refs.cables);

  // Lex specialis, stated before lex superior: the corridor, declared special to planting, prevails even over the base.
  assert.deepEqual(report(db, milli('special-wins', { includes: both(true), resolution: ['specialis', 'superior'],
    specialis: [{ special: refs.cables, general: refs.plant }] })).checks.conflicts[0].resolution,
    { prevails: refs.cables, setAside: refs.plant, by: 'specialis' });

  // For each pair, the contract with precedence decides which is special: an included contract declares planting
  // special, and the composition's own opposite declaration outranks it.
  const plantSpecial = addContract(db, { id: 'plant-special', scale: 'micro', title: 'plant-special', filedBy: 'planners', source: 'test',
    specialis: [{ special: refs.plant, general: refs.cables }] }).ref;
  const withDeclarer = [...both(), { contract: plantSpecial, mode: 'add' }];
  const declared = milli('declared-inside', { includes: withDeclarer, resolution: ['specialis'] });
  assert.equal(report(db, declared).checks.conflicts[0].resolution.prevails, refs.plant);
  assert.ok(snapshot(db, declared).reached.some(x => x.ref === plantSpecial && x.depth === 1 && x.via === plantSpecial),
    'a snapshot lists the contracts it reached, and through which include');
  assert.equal(report(db, milli('declared-over', { includes: withDeclarer, resolution: ['specialis'],
    specialis: [{ special: refs.cables, general: refs.plant }] })).checks.conflicts[0].resolution.prevails, refs.cables);

  // Abrogation takes a whole included contract out, and is kept to be shown.
  const repealed = milli('repealed', { includes: both(), operations: [{ op: 'abrogate', contract: contracts.utilities }] });
  r = report(db, repealed);
  assert.ok(!find(r.tree, refs.power), 'an abrogated contract’s intents leave the composition');
  assert.ok(!r.clauses.includes(refs.cables));
  assert.deepEqual(r.checks.operations.map(o => [o.op, o.contract, o.by]), [['abrogate', contracts.utilities, repealed]]);

  // Derogation takes one provision out: its claims leave scope, and it stays visible.
  r = report(db, milli('derogated', { includes: [{ contract: contracts.streetTrees, mode: 'add' }], operations: [{ op: 'derogate', nano: refs.barriers }] }));
  assert.ok(!r.clauses.includes(refs.barriers));
  assert.ok(!r.claims[refs.barrierHolds], 'claims about a derogated clause leave scope');
  assert.ok(r.nanos[refs.barriers], 'what an operator acts on stays visible');

  // Obrogation replaces a provision; subrogation adds one into an included contract.
  const everySecond = addNano(db, { id: 'plant-every-second', kind: 'clause', role: 'council', modality: 'shall',
    text: 'Plant a tree at every second spacing interval.', filedBy: 'planners', source: 'test' }).ref;
  r = report(db, milli('obrogated', { includes: [{ contract: contracts.streetTrees, mode: 'add' }],
    operations: [{ op: 'obrogate', nano: refs.plant, replacement: everySecond }] }));
  assert.ok(r.clauses.includes(everySecond) && !r.clauses.includes(refs.plant));
  r = report(db, milli('subrogated', { includes: [{ contract: contracts.streetTrees, mode: 'add' }],
    operations: [{ op: 'subrogate', contract: contracts.streetTrees, nano: refs.party }] }));
  assert.ok(r.clauses.includes(refs.party));

  // The store keeps operators well-formed, and a new revision carries them.
  assert.throws(() => milli('bad-target', { includes: both(), operations: [{ op: 'derogate', nano: refs.shade }] }), /operators act on provisions/);
  assert.throws(() => milli('no-replacement', { includes: both(), operations: [{ op: 'obrogate', nano: refs.plant }] }), /CHECK constraint failed/);
  const next = reviseContract(db, 'base-trees', { filedBy: 'planners', source: 'test' }).ref;
  assert.deepEqual(catalogue(db).contracts[next].resolution, ['superior']);
  assert.equal(catalogue(db).contracts[next].includes.find(i => i.ref === contracts.streetTrees).base, true);
});

test('socioship is structure: every milli defines its terms, and what it leaves undefined is a gap', () => {
  const { db, contracts } = buildFixture();
  addVocabulary(db, 'role', 'resident', 'A resident of the town');
  const charter = addNano(db, { id: 'keep-the-charter', kind: 'clause', role: 'resident', modality: 'shall', binding: 'abide',
    text: 'Keep the town charter to keep a place in the town.', filedBy: 'planners', source: 'test' }).ref;
  const chartered = reviseContract(db, 'town', { addSocioship: [{ term: 'conditions', nano: charter }], filedBy: 'planners', source: 'test' }).ref;
  const r = report(db, chartered);
  const term = id => r.socioship.find(t => t.id === id);
  assert.deepEqual(r.socioship.map(t => t.id), ['admission', 'born', 'conditions', 'lost', 'kept', 'deme']);
  assert.equal(term('conditions').status, 'defined');
  assert.deepEqual(term('conditions').nanos, [charter]);
  assert.equal(term('admission').status, 'default', 'every signatoree signs too, unless the milli says otherwise');
  assert.deepEqual(r.checks.socioshipGaps, ['born', 'lost', 'kept', 'deme']);
  assert.ok(r.clauses.includes(charter), 'a clause that defines socioship is one of the milli’s clauses');
  assert.ok(!r.checks.orphans.includes(charter), 'it serves the milli’s structure, so it is no orphan');

  // A milli that includes this one takes its terms, unless it defines them itself.
  const region = addContract(db, { id: 'region', scale: 'social', title: 'Region', filedBy: 'planners', source: 'test',
    includes: [{ contract: chartered, mode: 'add' }] }).ref;
  assert.equal(report(db, region).socioship.find(t => t.id === 'conditions').setBy, chartered);

  // A micro has no socioship: it is composed into a milli first.
  assert.equal(report(db, contracts.streetTrees).socioship, null);
  assert.throws(() => addContract(db, { id: 'loose', scale: 'micro', title: 'x', filedBy: 'planners', source: 'test',
    socioship: [{ term: 'conditions', nano: charter }] }), /defined by a milli/);
  assert.throws(() => reviseContract(db, 'town', { addSocioship: [{ term: 'citizenship', nano: charter }], filedBy: 'planners', source: 'test' }),
    /FOREIGN KEY/);

  // A retired contract leaves the list, and stays in the catalogue.
  reviseContract(db, 'utilities', { status: 'retired', filedBy: 'utility', source: 'test' });
  assert.ok(!listContracts(db).some(c => c.id === 'utilities'));
  assert.equal(catalogue(db).contracts['utilities@2'].status, 'retired');
});

const square = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });

test('segments relate as within, equal, overlapping, touching or disjoint', () => {
  assert.equal(relate(square(0, 0, 2, 2), square(1, 0, 3, 2)), 'overlaps', 'edges running along each other, interiors overlapping');
  assert.equal(relate(square(0, 0, 1, 1), square(0, 0, 2, 2)), 'within', 'nested in a shared corner');
  assert.equal(relate(square(0, 0, 2, 2), square(0, 0, 1, 1)), 'contains');
  assert.equal(relate(square(0, 0, 2, 2), square(0, 0, 2, 2)), 'equal');
  assert.equal(relate(square(0, 0, 1, 1), square(1, 0, 2, 1)), 'touches', 'a shared border is not an overlap');
  assert.equal(relate(square(0, 0, 1, 1), square(5, 5, 6, 6)), 'disjoint');
  const ring = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  assert.equal(relate(square(4.5, 4.5, 5.5, 5.5), ring), 'disjoint', 'inside a hole is outside the segment');
  assert.equal(relate(square(3, 3, 7, 7), ring), 'overlaps', 'covering a hole is not lying within');
  assert.equal(relate(square(1, 1, 2, 2), ring), 'within');
});

test('demesnes nest as segmentations and islands, and layers are shown or hidden', () => {
  const { db, contracts } = buildFixture();
  const milli = (id, title) => addContract(db, { id, scale: 'social', title, filedBy: 'planners', source: 'test' }).ref;
  const defence = milli('defence', 'Defence'), culture = milli('culture', 'Culture'), atmosphere = milli('atmosphere', 'Atmosphere');
  const demesne = (id, name, m, segment) => addDemesne(db, { id, name, milli: m, space: 'earth', segment, filedBy: 'planners', source: 'test' }).ref;
  const shield = demesne('shield', 'The shield', defence, square(0, 0, 10, 10));
  const west = demesne('west', 'The west', culture, square(0, 0, 5, 10));
  const east = demesne('east', 'The east', culture, square(5, 0, 10, 10));
  const quiet = demesne('quiet-isle', 'A quiet isle', atmosphere, square(1, 1, 2, 2));
  const loud = demesne('loud-isle', 'A loud isle', atmosphere, square(6, 6, 7, 7));
  const coast = demesne('coast', 'The coast', culture, square(9, 4, 12, 6));   // straddles the shield's edge

  const all = layering(catalogue(db).demesnes, 'earth');
  const of = ref => all.find(d => d.ref === ref);
  assert.deepEqual([shield, west, east, quiet, loud, coast].map(r => of(r).level), [1, 2, 2, 3, 3, 1]);
  assert.deepEqual(of(quiet).within, [shield, west], 'outermost first');
  assert.equal(of(quiet).parent, west);
  assert.equal(of(shield).segmentation.kind, 'exhaustive', 'the west and the east segment the shield with nothing left over');
  assert.equal(of(west).segmentation.kind, 'partial', 'an island covers a share of the west');
  assert.equal(of(west).segmentation.share, 1 / 50);
  assert.equal(of(quiet).segmentation, null);
  assert.deepEqual(of(coast).overlaps.sort(), [east, shield].sort());
  assert.deepEqual(of(west).touches, [east]);

  assert.deepEqual(stackAt(all, [1.5, 1.5]).map(d => d.ref), [shield, west, quiet]);
  assert.deepEqual(stackAt(all, [11, 5]).map(d => d.ref), [coast]);
  assert.deepEqual(stackAt(all, [30, 30]), []);

  // Layers by nesting level, or by milli. Hiding the layers above frees their pattern for the layers below.
  const levels = layersOf(all);
  assert.deepEqual(levels.map(l => [l.key, l.demesnes.length]), [['1', 2], ['2', 2], ['3', 2]]);
  const every = paint(all, levels, new Set(['1', '2', '3']));
  assert.equal(every.get(quiet).pattern, 2);
  assert.notEqual(every.get(west).colour, every.get(east).colour, 'demesnes that meet in a layer differ in colour');
  assert.notEqual(every.get(shield).colour, every.get(coast).colour);
  const deeper = paint(all, levels, new Set(['3']));
  assert.equal(deeper.get(quiet).pattern, 0, 'with the layers above hidden, the islands take the first pattern');
  assert.equal(deeper.has(shield), false);
  assert.deepEqual(layersOf(all, 'milli').map(l => l.label), ['Culture', 'Defence', 'Atmosphere']);

  // A demesne grows by a new revision; the old one is kept.
  assert.equal(addDemesne(db, { id: 'quiet-isle', name: 'A quiet isle', milli: atmosphere, space: 'earth', segment: square(1, 1, 6, 2),
    filedBy: 'planners', source: 'test' }).ref, 'quiet-isle@2');
  const grown = layering(catalogue(db).demesnes, 'earth').find(d => d.id === 'quiet-isle');
  assert.equal(grown.parent, shield, 'grown across the west and the east, it lies directly within the shield');
  assert.deepEqual(grown.overlaps.sort(), [east, west].sort());
  assert.equal(catalogue(db).demesnes.length, 7);

  const input = { name: 'x', space: 'earth', filedBy: 'planners', source: 'test' };
  assert.throws(() => addDemesne(db, { ...input, id: 'grove', milli: contracts.streetTrees, segment: square(0, 0, 1, 1) }), /only a milli/);
  assert.throws(() => addDemesne(db, { ...input, id: 'spot', milli: defence, segment: { type: 'Point', coordinates: [1, 1] } }), /Polygon or MultiPolygon/);
  assert.throws(() => addDemesne(db, { ...input, id: 'open', milli: defence, segment: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } }),
    /end where it starts/);
  assert.throws(() => db.prepare("UPDATE demesne_rev SET name = 'x'").run(), /immutable/);
});

test('a demesne is in force over a period, and a successor comes after another: succession is never continuity', () => {
  const { db } = buildFixture();
  const milli = (id, title) => addContract(db, { id, scale: 'social', title, filedBy: 'planners', source: 'test' }).ref;
  const kingship = milli('kingship', 'Kingship'), succession = milli('successors', 'The successors');
  const by = { space: 'earth', filedBy: 'planners', source: 'test' };
  const empire = addDemesne(db, { ...by, id: 'empire', name: 'The empire', milli: kingship, segment: square(0, 0, 10, 10),
    from: '-0336', until: '-0323' }).ref;
  const north = addDemesne(db, { ...by, id: 'north', name: 'The northern share', milli: succession, segment: square(0, 5, 10, 10),
    from: '-0323', after: empire }).ref;

  // An instant is a year, a month or a day, as coarse as the record: a year covers all of it, a day is one day.
  assert.equal(instant('1789-04-30').start, instant('1789-04-30').end);
  assert.ok(instant('1806-08').start > instant('1806').start && instant('1806-08').end < instant('1806').end);
  assert.equal(instant('323 BC'), null);

  const at = when => layering(catalogue(db).demesnes, 'earth', { when }).map(d => d.ref).sort();
  assert.deepEqual(at('-0330'), [empire], 'while the empire is in force, it alone');
  assert.deepEqual(at('-0320'), [north], 'once it has ended, what came after it');
  assert.deepEqual(at('-0323'), [empire, north].sort(), 'in the year it ended and the successor began, both');
  assert.deepEqual(at(null), [empire, north].sort(), 'with no instant, every demesne, whenever it was in force');
  assert.equal(catalogue(db).demesnes.find(d => d.ref === north).after, empire, 'the successor records what it came after');

  const spot = { ...by, name: 'x', milli: kingship, segment: square(0, 0, 1, 1) };
  assert.throws(() => addDemesne(db, { ...spot, id: 'muddle', from: 'the spring' }), /year, month or day/);
  assert.throws(() => addDemesne(db, { ...spot, id: 'backwards', from: '1800', until: '1799' }), /in force until before/);
  assert.throws(() => addDemesne(db, { ...spot, id: 'empire', after: 'empire' }), /never continuity/);
  assert.throws(() => addDemesne(db, { ...spot, id: 'orphan', after: 'nowhere' }), /no demesne/);
});

test('a contract says what it is: one to compose with, a record of what was, or an example', () => {
  const { db } = buildFixture();
  const by = { filedBy: 'planners', source: 'test' };
  const now = addContract(db, { ...by, id: 'now', scale: 'micro', title: 'Now' }).ref;
  assert.equal(catalogue(db).contracts[now].case, 'proposed', 'what a contract is unless it says otherwise');
  const then = addContract(db, { ...by, id: 'then', scale: 'social', title: 'Then', case: 'historical', source: 'Diodorus 18.3' }).ref;
  assert.equal(catalogue(db).contracts[then].case, 'historical');
  assert.equal(listContracts(db).find(c => c.id === 'then').case, 'historical', 'and the listing says so');

  const renamed = reviseContract(db, 'then', { ...by, title: 'Then, renamed' }).ref;
  assert.equal(catalogue(db).contracts[renamed].case, 'historical', 'a revision keeps what the contract is');
  const made_up = reviseContract(db, 'then', { ...by, case: 'fictive' }).ref;
  assert.equal(catalogue(db).contracts[made_up].case, 'fictive', 'unless it is given another');
  assert.throws(() => addContract(db, { ...by, id: 'odd', scale: 'micro', title: 'Odd', case: 'invented' }), /CHECK/);

  // A demesne pins one revision of its milli, so it carries what that revision is.
  const empire = addDemesne(db, { ...by, id: 'empire-of-then', name: 'The empire', milli: then, space: 'earth',
    segment: square(0, 0, 3, 3), from: '-0336', until: '-0323' }).ref;
  assert.equal(catalogue(db).demesnes.find(d => d.ref === empire).case, 'historical', 'the revision it pins, not the latest');
});

test('stores are separate files and one space to compose in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'composer-stores-'));
  const contracts = openStore(join(dir, 'contracts.sqlite'));
  const knowledge = openStore(join(dir, 'knowledge.sqlite'));
  for (const db of [contracts, knowledge]) {
    addVocabulary(db, 'author', 'planners', 'Planners');
    addVocabulary(db, 'role', 'council', 'Council');
  }
  const by = { filedBy: 'planners', source: 'test' };
  const clause = (db, id, text) => addNano(db, { ...by, id, kind: 'clause', role: 'council', modality: 'shall', text }).ref;

  // What is known, in its own store; what is agreed to, in the other.
  const finding = clause(knowledge, 'shade-cools', 'Shade lowers the temperature beneath it.');
  const body = addContract(knowledge, { ...by, id: 'what-shade-does', scale: 'micro', title: 'What shade does', case: 'proposed',
                                        members: [finding] }).ref;
  const rule = clause(contracts, 'plant-trees', 'Plant trees along the street.');
  const milli = addContract(contracts, { ...by, id: 'street', scale: 'social', title: 'The street', members: [rule] }).ref;

  const space = mergeCatalogues(catalogue(contracts), catalogue(knowledge));
  assert.ok(space.contracts[body] && space.contracts[milli], 'both stores are in the one space');

  // A milli composes the knowledge it attaches, which neither store could reach alone.
  const draft = { ...space.contracts[milli], ref: undefined, includes: [{ ref: body, mode: 'add' }] };
  assert.ok(compose(space, draft).clauses.includes(finding), 'what the body of knowledge holds is in the composition');
  assert.throws(() => compose(catalogue(contracts), draft), /no contract/, 'and one store alone cannot reach it');

  // The same ref in two stores is the same thing…
  const again = clause(knowledge, 'plant-trees', 'Plant trees along the street.');
  assert.equal(again, rule, 'written word for word, it is one nano');
  assert.ok(mergeCatalogues(catalogue(contracts), catalogue(knowledge)).nanos[rule], 'and the space holds it once');

  // …or it is a fault, never a winner picked for you.
  const elsewhere = openStore(join(dir, 'elsewhere.sqlite'));
  addVocabulary(elsewhere, 'author', 'planners', 'Planners');
  addVocabulary(elsewhere, 'role', 'council', 'Council');
  clause(elsewhere, 'plant-trees', 'Plant hedges along the street instead.');
  assert.throws(() => mergeCatalogues(catalogue(contracts), catalogue(elsewhere)), /is in two stores, and they differ/);
});

test('relinking follows a pico to the revision its contract defines, and leaves the text alone', () => {
  const { db } = buildFixture();
  const by = { filedBy: 'planners', source: 'test' };
  addVocabulary(db, 'term', 'midday-shade', 'midday shade');
  const first = addNano(db, { ...by, id: 'midday-shade.trees', kind: 'definition', term: 'midday-shade', forms: ['midday shade'],
                              meaning: 'Cover from the sun.' }).ref;
  const clause = addNano(db, { ...by, id: 'plant-for-midday-shade', kind: 'clause', role: 'council', modality: 'shall',
                               text: 'Plant trees for midday shade.', picos: [{ phrase: 'midday shade', pico: first }] }).ref;
  addContract(db, { ...by, id: 'shade-rules', scale: 'micro', title: 'Shade', members: [first, clause] });

  // A better definition of the word, adopted by the contract: the clause still names the revision it was written with.
  const second = addNano(db, { ...by, id: 'midday-shade.trees', kind: 'definition', term: 'midday-shade', forms: ['midday shade'],
                               meaning: 'Cover from the sun when it stands highest.' }).ref;
  reviseContract(db, 'shade-rules', { ...by, replace: { [first]: second } });
  assert.equal(catalogue(db).nanos[clause].picos[0].pico, first, 'until it is relinked');

  relinkContract(db, 'shade-rules', { filedBy: 'planners', source: 'relinked in a test' });
  const cat = catalogue(db);
  const now = Object.values(cat.contracts).filter(c => c.id === 'shade-rules').sort((a, b) => b.rev - a.rev)[0];
  const rewritten = now.members.map(ref => cat.nanos[ref]).find(n => n.id === 'plant-for-midday-shade');
  assert.equal(rewritten.picos[0].pico, second, 'the clause records the revision the contract defines');
  assert.equal(rewritten.text, 'Plant trees for midday shade.', 'and its words are untouched');
  assert.equal(rewritten.rev, 2, 'by a new revision, never by changing the old one');
});

test('the example demesnes nest as described: a shield segmented exhaustively, with islands within', () => {
  const all = layering(EXAMPLE, 'earth');
  const of = id => all.find(d => d.id === `example-${id}`);
  assert.equal(of('shield').segmentation.kind, 'exhaustive');
  assert.deepEqual(['shield', 'north-west', 'quiet-quarter', 'silent-garden'].map(id => of(id).level), [1, 2, 3, 4]);
  for (const id of ['craft-quarter', 'harbour-quarter', 'festival-grounds', 'scholars-quarter', 'market-quarter']) assert.equal(of(id).level, 3, id);
  assert.equal(of('north-east').segmentation.kind, 'partial');

  // One quarter ends and another comes after it, so an instant shows what was in force then.
  assert.equal(of('works-quarter').level, 3);
  const at = when => layering(EXAMPLE, 'earth', { when }).map(d => d.id);
  assert.ok(at('1880').includes('example-craft-quarter') && !at('1880').includes('example-works-quarter'), 'before the succession');
  assert.ok(at('1900').includes('example-works-quarter') && !at('1900').includes('example-craft-quarter'), 'after it');
  assert.equal(at(null).length, EXAMPLE.length, 'with no instant, every demesne, whenever it was in force');
});
