import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPEND_ONLY } from '../server/store.mjs';
import { buildFixture } from './fixture.mjs';

test('nothing written can be changed or removed, in any table that holds a revision or a part of one', () => {
  const { db } = buildFixture();
  let tried = 0;
  for (const table of APPEND_ONLY) {
    if (!db.prepare(`SELECT count(*) FROM ${table}`).pluck().get()) continue;
    assert.throws(() => db.prepare(`DELETE FROM ${table}`).run(), /append-only|immutable|fixed/, `${table} refuses deletes`);
    assert.throws(() => db.prepare(`UPDATE ${table} SET rowid = rowid`).run(), /append-only|immutable|fixed/, `${table} refuses updates`);
    tried++;
  }
  for (const table of ['contract_refines', 'contract_include', 'claim_given', 'claim_when', 'nano', 'contract'])
    assert.ok(db.prepare(`SELECT count(*) FROM ${table}`).pluck().get(), `the fixture exercises ${table}`);
  assert.ok(tried >= 20, `${tried} tables checked`);
});
