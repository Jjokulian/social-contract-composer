// Snapshots and reports for stored contracts. Composition (public/compose.mjs) and evaluation (public/evaluate.mjs)
// are pure JavaScript shared with the browser; the store supplies the catalogue they work on.
import { resolveContract, catalogue, StoreError } from './store.mjs';
import { compose } from '../public/compose.mjs';
import { evaluate } from '../public/evaluate.mjs';

export { evaluate, jointlyImpossible, compareContexts } from '../public/evaluate.mjs';
export { compose } from '../public/compose.mjs';

export function snapshot(db, contractRef) {
  const crid = resolveContract(db, contractRef);
  const ref = db.prepare("SELECT contract_id || '@' || rev FROM contract_rev WHERE crid = ?").pluck().get(crid);
  const cat = catalogue(db);
  return compose(cat, cat.contracts[ref]);
}

export function report(db, contractRef, { parameters = {}, society = null } = {}) {
  if (society !== null && !db.prepare('SELECT 1 FROM society WHERE id = ?').get(society))
    throw new StoreError(`no society ${society}`, 404);
  return evaluate(snapshot(db, contractRef), { parameters, society });
}
