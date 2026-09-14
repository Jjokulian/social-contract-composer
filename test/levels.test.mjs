import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addContract, catalogue } from '../server/store.mjs';
import { levelGraph } from '../public/levels.mjs';
import { buildFixture } from './fixture.mjs';

test('the levels graph draws millis, micros, nanos and picos, with composing, operators and precedence between them', () => {
  const { db, refs, contracts } = buildFixture();
  const milli = addContract(db, { id: 'base-trees', scale: 'social', title: 'Base trees', filedBy: 'planners', source: 'test',
    includes: [{ contract: contracts.streetTrees, mode: 'add', base: true }, { contract: contracts.utilities, mode: 'add' }],
    resolution: ['superior'], operations: [{ op: 'derogate', nano: refs.barriers }] }).ref;
  const cat = catalogue(db);
  const all = levelGraph(cat);
  const node = id => all.nodes.find(n => n.id === id);
  const edge = (kind, source, target) => all.edges.find(e => e.kind === kind && e.source === source && e.target === target);

  assert.deepEqual([milli, contracts.streetTrees, refs.plant, 'street-tree@1'].map(id => node(id).level), ['milli', 'micro', 'nano', 'pico']);
  assert.equal(edge('composes', milli, contracts.streetTrees).label, 'adds · base');
  assert.equal(edge('composes', contracts.town, contracts.streetTrees).label, 'nests');
  assert.equal(edge('operates', milli, refs.barriers).op, 'derogate');
  assert.ok(edge('holds', contracts.streetTrees, refs.plant));
  assert.ok(edge('uses', refs.plant, 'street-tree@1'));
  assert.equal(edge('claims', refs.plant, refs.shade).relation, 'supports');
  assert.equal(edge('precedence', refs.plant, refs.cables).maxim, 'superior', 'the base’s clause prevails over the corridor, by lex superior');
  assert.ok(!all.nodes.some(n => n.kind === 'claim'), 'claims are connections, not nodes');

  // A hidden level is crossed, not cut: millis and picos alone stay connected through the micros and nanos between them.
  const sparse = levelGraph(cat, { levels: ['milli', 'pico'] });
  assert.ok(sparse.nodes.every(n => n.level === 'milli' || n.level === 'pico'));
  assert.ok(sparse.edges.some(e => e.kind === 'through' && e.source === milli && e.target === 'street-tree@1'));

  // Scoped to one contract: it and what it reaches, nothing else.
  const around = levelGraph(cat, { scope: 'street-trees' });
  assert.ok(around.nodes.some(n => n.id === refs.plant));
  assert.ok(!around.nodes.some(n => n.id === contracts.utilities || n.id === milli));

  // Relations can be turned off one by one.
  assert.ok(!levelGraph(cat, { relations: ['composes'] }).edges.some(e => e.kind === 'operates'));
});
