import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { openStore, catalogue, SYSTEM_PATH } from '../server/store.mjs';
import { split, compare, extract, rebuild } from '../server/platform.mjs';

test('each kind of file splits into units that join back into the file exactly', () => {
  const samples = {
    'a.mjs': "#!/usr/bin/env node\n// A module.\nimport { x } from './b.mjs';\n\nconst y = 1;   // one\nexport function f() { return x + y; }\n// the end\n",
    'a.sql': "-- tables\nCREATE TABLE t (id TEXT);\nCREATE TRIGGER g BEFORE INSERT ON t\nBEGIN SELECT RAISE(ABORT, 'no; never'); END;\nPRAGMA foreign_keys = ON;\n",
    'a.css': '/* a */\n.a { color: red; }\n@media (max-width: 1px) { .a { color: blue; } }\n',
    'a.md': '# Title\n\nIntro.\n\n## One\n\nText.\n\n## Two\n',
    'a.json': '{ "a": 1 }\n',
  };
  for (const [path, text] of Object.entries(samples)) assert.equal(split(path, text).map(u => u.text).join(''), text, path);
  assert.deepEqual(split('a.mjs', samples['a.mjs']).map(u => `${u.form} ${u.name}`), ['import ./b.mjs', 'const y', 'function f', 'tail null']);
  assert.deepEqual(split('a.sql', samples['a.sql']).map(u => `${u.form} ${u.name}`), ['table t', 'trigger g', 'pragma foreign_keys'],
    'a semicolon inside a trigger or a string does not end the statement');
  assert.deepEqual(split('a.css', samples['a.css']).map(u => u.form), ['rule', 'media']);
  assert.deepEqual(split('a.md', samples['a.md']).map(u => u.name), ['Title', 'One', 'Two']);
});

test('the platform’s store rebuilds every source file byte for byte, its rebuilder and this test included', () => {
  const db = openStore(SYSTEM_PATH, { readonly: true });
  const { missing, stale, mismatched } = compare(db);
  const hint = 'run node tools/platform.mjs extract before committing';
  assert.deepEqual(missing, [], hint);
  assert.deepEqual(stale, [], hint);
  assert.deepEqual(mismatched, [], hint);
  const built = rebuild(db);
  for (const path of ['server/platform.mjs', 'tools/platform.mjs', 'test/platform.test.mjs', 'store/schema.sql'])
    assert.ok(built.has(path), `${path} is in the store`);
  const unit = id => Object.values(catalogue(db).nanos).filter(n => n.id === id).sort((a, b) => b.rev - a.rev)[0];
  assert.ok(!unit('code.server.platform.mjs.function-sql-unit').depends.some(d => d.id === 'code.server.platform.mjs.const-head'),
    'sqlUnit’s own local head is not the top-level head: dependencies are resolved through scopes');
});

test('extraction is a fixed point: run again on its own result, it writes nothing', () => {
  const copy = new Database(openStore(SYSTEM_PATH, { readonly: true }).serialize());
  copy.pragma('foreign_keys = ON');
  assert.equal(extract(copy).written, 0);
});
