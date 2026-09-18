// Snapshots and reports for stored contracts. Composition (public/compose.mjs) and evaluation (public/evaluate.mjs)
// are pure JavaScript shared with the browser; the store supplies the catalogue they work on.
import { resolveContract, catalogue, StoreError } from './store.mjs';
import { compose } from '../public/compose.mjs';
import { evaluate } from '../public/evaluate.mjs';

export { evaluate, jointlyImpossible, compareContexts } from '../public/evaluate.mjs';
export { compose } from '../public/compose.mjs';

// A contract's snapshot. Pass the store's catalogue when composing many, so it is built once, not once per snapshot.
export function snapshot(db, contractRef, cat = catalogue(db)) {
  const crid = resolveContract(db, contractRef);
  const ref = db.prepare("SELECT contract_id || '@' || rev FROM contract_rev WHERE crid = ?").pluck().get(crid);
  return compose(cat, cat.contracts[ref]);
}

// `cat` is the space to compose in, where that is more than this one store: the catalogue and the bodies of knowledge
// are merged before anything is composed (server/store.mjs), so a milli reaches the knowledge it attaches.
export function report(db, contractRef, { parameters = {}, society = null, cat } = {}) {
  if (society !== null && !db.prepare('SELECT 1 FROM society WHERE id = ?').get(society))
    throw new StoreError(`no society ${society}`, 404);
  return evaluate(snapshot(db, contractRef, cat), { parameters, society });
}
