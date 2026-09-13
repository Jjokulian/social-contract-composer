// A small, deliberately neutral composition that exercises every check the composer runs.
// Nothing here is catalogue content: it exists so the system is never shaped around one contract.
//
//   town (social)
//   ├─ livable-town ─ nests ─ street-trees (micro): green-streets → shade-walkers, safe-sidewalks
//   └─ adds ─ utilities (micro): reliable-power, quiet-streets
import { openStore, addVocabulary, addNano, addContract } from '../server/store.mjs';

export function buildFixture() {
  const db = openStore(':memory:');
  const vocab = (table, entries) => Object.entries(entries).forEach(([id, label]) => addVocabulary(db, table, id, label));
  vocab('author', { planners: 'Street planners', utility: 'Utility board', critic: 'A critic' });
  vocab('role', { council: 'The town council' });
  vocab('term', { 'street-tree': 'street tree' });
  vocab('unit', { metre: 'metres', mm: 'millimetres of rain per year', count: 'count' });
  vocab('society', { dryville: 'Dryville', wetton: 'Wetton' });

  const add = (id, kind, body, filedBy = 'planners') => addNano(db, { id, kind, filedBy, source: 'fixture', ...body }).ref;

  // Nanos
  const greenStreets = add('green-streets', 'intent', { statement: 'Green streets' });
  const shade = add('shade-walkers', 'intent', { statement: 'Shade for people walking' });
  const safe = add('safe-sidewalks', 'intent', { statement: 'Sidewalks nobody trips on' });
  const power = add('reliable-power', 'intent', { statement: 'Power that stays on' });
  const quiet = add('quiet-streets', 'intent', { statement: 'Quiet streets' });
  const livable = add('livable-town', 'intent', { statement: 'A livable town' });

  const treeNarrow = add('street-tree', 'definition', { term: 'street-tree', meaning: 'A tree planted in the public right of way.' });
  const plant = add('plant-trees', 'clause', { role: 'council', modality: 'shall', text: 'Plant a street tree at every spacing interval.',
    picos: [{ phrase: 'street tree', pico: treeNarrow }] });
  const barriers = add('root-barriers', 'clause', { role: 'council', modality: 'shall', text: 'Fit root barriers under every sidewalk tree.' });
  const cables = add('underground-cables-clear', 'clause', { role: 'council', modality: 'shall', binding: 'abide',   // a rule to keep, though phrased as "shall"
    text: 'Keep a clear corridor above underground cables.' });
  const party = add('annual-street-party', 'clause', { role: 'council', modality: 'shall', text: 'Close one street a year for a party.' });
  const water = add('water-young-trees', 'clause', { role: 'council', modality: 'shall', text: 'Water every tree for its first three summers.' });

  const treeBroad = add('street-tree-broad', 'definition', { term: 'street-tree', meaning: 'Any tree visible from a street.',
    forms: ['street tree', 'street trees'] }, 'utility');

  const spacing = add('tree-spacing', 'parameter', { label: 'Tree spacing', unit: 'metre', min: 5, max: 30, meaning: 'Distance between street trees.' });
  const rainfall = add('annual-rainfall', 'measure', { label: 'Annual rainfall', unit: 'mm', description: 'Mean rainfall over ten years.' });
  const canopy = add('canopy-cover', 'measure', { label: 'Canopy cover', unit: 'count', description: 'Trees with a closed crown per kilometre of street.' });
  const rainFeedsCanopy = add('rain-feeds-canopy', 'influence', { from: rainfall, direction: 'raises', to: canopy, rationale: 'Watered trees grow larger crowns.' }, 'critic');
  const wet = add('enough-rain', 'assumption', { statement: 'There is enough rain for trees to reach full canopy.', condition: { measure: rainfall, op: '>=', value: 500 } });
  const dry = add('too-little-rain', 'assumption', { statement: 'Trees stay small for lack of rain.', condition: { measure: rainfall, op: '<', value: 500 } }, 'critic');

  const claim = (id, body, filedBy) => add(id, 'claim', body, filedBy);
  const c = {
    shadeDense: claim('plant-shades-dense', { from: plant, relation: 'supports', to: shade, strength: 'sufficient',
      when: [{ parameter: spacing, op: '<=', value: 15 }], rationale: 'Close-set trees make a continuous canopy.' }),
    shadeSparse: claim('plant-shades-sparse', { from: plant, relation: 'supports', to: shade, strength: 'contributes',
      when: [{ parameter: spacing, op: '>', value: 15 }], rationale: 'Far-apart trees leave gaps in the shade.' }, 'critic'),
    shadeWet: claim('plant-shades-wet', { from: plant, relation: 'supports', to: shade, strength: 'sufficient',
      given: [water], assuming: [wet], measuredBy: [rainfall], rationale: 'With enough rain and early watering, the canopy closes.' }),
    shadeDry: claim('plant-shades-dry', { from: plant, relation: 'supports', to: shade, strength: 'contributes',
      assuming: [dry], rationale: 'Without rain the trees stay small.' }, 'critic'),
    rootsLift: claim('plant-lifts-pavement', { from: plant, relation: 'hinders', to: safe, given: [plant],
      rationale: 'Roots lift paving slabs.' }),
    treesBuffer: claim('plant-buffers-traffic', { from: plant, relation: 'supports', to: safe, given: [plant],
      when: [{ parameter: spacing, op: '>=', value: 8 }], rationale: 'A line of trunks keeps cars off the sidewalk.' }, 'critic'),
    barrierHolds: claim('barriers-hold-roots', { from: barriers, relation: 'supports', to: safe, strength: 'sufficient',
      given: [barriers], rationale: 'Barriers steer roots down.' }),
    barriersHelp: claim('barriers-help', { from: barriers, relation: 'supports', to: safe,
      rationale: 'Barriers keep most roots down.' }),   // the weaker, context-free version of barriers-hold-roots: a refinement
    barrierHeaves: claim('barriers-heave', { from: barriers, relation: 'hinders', to: safe,
      given: [barriers], rationale: 'Barriers crack in frost and heave the slabs.' }, 'critic'),
    cablesPower: claim('corridor-keeps-power', { from: cables, relation: 'supports', to: power, strength: 'sufficient',
      rationale: 'Crews reach faults without digging up roots.' }, 'utility'),
    treesVsCables: claim('trees-block-corridor', { from: plant, relation: 'conflicts', to: cables,
      rationale: 'Planting at every interval puts trees on top of cable corridors.' }, 'critic'),
  };

  const canopyShades = add('canopy-shades', 'influence', { from: canopy, direction: 'bears-on', to: shade, rationale: 'Shade comes from closed crowns.' }, 'critic');
  const warning = add('written-warning', 'consequence', { statement: 'A written warning' });
  const fine = add('street-fine', 'consequence', { statement: 'A fine paid to the street fund' });

  const streetTrees = addContract(db, {
    id: 'street-trees', scale: 'micro', title: 'Street Trees', filedBy: 'planners', source: 'fixture',
    intents: [{ ref: greenStreets }, { ref: shade, parent: greenStreets }, { ref: safe, parent: greenStreets }],
    members: [plant, barriers, water, treeNarrow, rainfall, canopy, wet, c.shadeDense, c.shadeWet, c.rootsLift, c.barrierHolds],
    parameters: { [spacing]: 10 },
    breaches: [{ clause: plant, consequence: warning }, { clause: barriers, consequence: warning }],
  });
  const utilities = addContract(db, {
    id: 'utilities', scale: 'micro', title: 'Utilities', filedBy: 'utility', source: 'fixture',
    intents: [{ ref: power }, { ref: quiet }],
    members: [cables, party, treeBroad, c.cablesPower],
  });
  const town = addContract(db, {
    id: 'town', scale: 'social', title: 'Town', filedBy: 'planners', source: 'fixture',
    intents: [{ ref: livable }],
    includes: [{ contract: streetTrees.ref, mode: 'nest', under: livable }, { contract: utilities.ref, mode: 'add' }],
    breaches: [{ clause: plant, consequence: fine }],   // the town overrides street-trees for this clause
    enforcement: [{ clause: plant, by: 'council' }],     // and assigns who detects breaches of it; barriers' warning has no one
  });

  add('dryville-rain', 'evaluation', { measure: rainfall, society: 'dryville', value: 300, observedOn: '2030', sourceUrl: 'https://example.org/dryville' }, 'critic');
  add('wetton-rain', 'evaluation', { measure: rainfall, society: 'wetton', value: 900, observedOn: '2030', sourceUrl: 'https://example.org/wetton' }, 'critic');

  return { db, refs: { greenStreets, shade, safe, power, quiet, livable, plant, barriers, cables, party, spacing,
                       rainfall, canopy, rainFeedsCanopy, canopyShades, warning, fine, ...c },
           contracts: { streetTrees: streetTrees.ref, utilities: utilities.ref, town: town.ref } };
}
