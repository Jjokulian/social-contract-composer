import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as acorn from 'acorn';
import { openStore, addVocabulary, addNano, describe, resolve } from '../server/store.mjs';
import { freeNames, shapeOf } from '../server/syntax.mjs';
import { split, extract } from '../server/platform.mjs';

const parse = source => acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body[0];

test('names are resolved through the scopes a compiler builds: locals are never dependencies', () => {
  const f = parse(`function f(head, [a, { b }] = [], ...rest) {
    const x = head + g; let y;
    try { y = a; } catch (e) { e + z; }
    for (const k of list) k;
    const o = { key: v, [kk]: 1, s, m() { return this; } }; o.prop;
    return class C { m() { return C + w + rest + b; } };
  }`);
  assert.deepEqual([...freeNames(f)].sort(), ['g', 'kk', 'list', 's', 'v', 'w', 'z']);
  assert.deepEqual([...freeNames(parse('const h = (p = q) => p + r;'))].sort(), ['q', 'r'], 'a default refers, a parameter binds');
  assert.deepEqual([...freeNames(parse('function sqlUnit(text) { const head = text.trim(); return head; }'))], [],
    'a local named like a top-level constant is local');
});

test('a unit’s shape ignores its name, its comments and its layout, and nothing else', () => {
  const a = shapeOf('const esc = s => String(s);', 'javascript', ['esc']);
  assert.equal(shapeOf('// Escape it.\nconst escapeHtml = s =>   String( s );', 'javascript', ['escapeHtml']), a);
  assert.notEqual(shapeOf('const esc = s => Number(s);', 'javascript', ['esc']), a);
  assert.equal(shapeOf('CREATE TABLE t (id TEXT); -- x', 'sql', ['t']), shapeOf('CREATE TABLE   u (id TEXT);', 'sql', ['u']));
});

test('a file’s opening comment is a unit of its own when a blank line separates it', () => {
  const text = '#!/usr/bin/env node\n// What this file is for.\n\n// The import.\nimport x from "./x.mjs";\n';
  assert.deepEqual(split('a.mjs', text).map(u => u.form), ['header', 'import']);
  assert.equal(split('a.mjs', text).map(u => u.text).join(''), text);
  assert.deepEqual(split('b.mjs', '// About x.\nconst x = 1;\n').map(u => u.form), ['const'], 'a comment on the statement stays with it');
  assert.deepEqual(split('c.sql', '-- The store.\n\nCREATE TABLE t (id TEXT);\n').map(u => u.form), ['header', 'table']);
});

test('a renamed or moved unit keeps what it implements: identity by shape, recorded as a move', () => {
  const root = mkdtempSync(join(tmpdir(), 'platform-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init', '-q');
    const write = (path, text) => { writeFileSync(join(root, path), text); git('add', '-A'); };
    write('a.mjs', '// Escaping.\n\nexport const esc = s => String(s).replace(/</g, "&lt;");\n');
    const db = openStore(':memory:');
    extract(db, { root });
    addVocabulary(db, 'term', 'html-escape', 'HTML escape');
    addNano(db, { id: 'html-escape.test', kind: 'definition', term: 'html-escape', meaning: 'Escaping HTML.', forms: ['escaping HTML'],
                  implementedBy: ['code.a.mjs.const-esc'], filedBy: 'platform', source: 'test' });
    const implementedBy = () => describe(db, resolve(db, 'html-escape.test')).implementedBy;

    write('a.mjs', '// Escaping.\n\nexport const escapeHtml = s => String(s).replace(/</g, "&lt;");\n');   // renamed
    extract(db, { root });
    assert.deepEqual(implementedBy(), ['code.a.mjs.const-escape-html']);

    write('a.mjs', '// Nothing left here.\n');   // moved to another file
    write('b.mjs', '// Escaping, moved.\n\n// escape it\nexport const escapeHtml = s => String( s ).replace(/</g, "&lt;");\n');
    extract(db, { root });
    assert.deepEqual(implementedBy(), ['code.b.mjs.const-escape-html'], 'the move is followed, through the rename');
    assert.equal(extract(db, { root }).written, 0, 'still a fixed point');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
