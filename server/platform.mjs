// The platform as data. Every source file of the repository is split into its units and stored in the platform's own
// store (store/system.sqlite), in the catalogue's structure, so that traversing the store rebuilds the software byte for
// byte. A data-structured quine: this module is one of the files it stores, and the rebuild test has the store rebuild
// this module, and the test itself.
//
//   unit     a nano of kind 'unit': one top-level statement of a module, one SQL statement, one CSS rule, one section of
//            a Markdown document, or a whole file where it has no smaller parts. It holds its exact text, with the
//            whitespace and comments before it, so a file is its units joined in order.
//   file     a micro holding its units, in order; its title is the file's path.
//   service  a micro including the files that make one service (SERVICES below).
//   The application milli, social-contract-composer, includes every service, with the vocabulary as its base.
//
// A unit that declares something and depends on no other unit (a constant, a leaf function, a CSS rule, a table that
// references nothing) is a logical unit, shown at the pico level; a unit that uses others is a functional unit, a nano.
// Extraction writes a new revision only for what changed, so a second run writes nothing: it is a fixed point. The stores
// are what it writes, never what it reads, as a compiler's source doesn't contain its own binary.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { addVocabulary, addNano, addContract, reviseContract, catalogue } from './store.mjs';
import { suggest } from '../public/picos.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const EXCLUDED = [/\.sqlite$/, /^cresume\.txt$/, /^dist\//];   // outputs, and a personal note: not the software
const AUTHOR = ['platform', 'Extracted from the repository by tools/platform.mjs'];

// The services the platform is made of, by the files that make each. A file no service claims falls into "Other files".
export const SERVICES = [
  ['store', 'The store', ['store/schema.sql', 'server/store.mjs', 'tools/sqlite-dump.mjs', '.gitattributes']],
  ['composition', 'Composition and evaluation', ['public/compose.mjs', 'public/evaluate.mjs', 'public/explain.mjs', 'server/checks.mjs']],
  ['picos', 'Writing with picos', ['public/picos.mjs', 'server/relink.mjs', 'tools/picos.mjs']],
  ['vocabulary', 'Rendering the vocabulary', ['server/vocabulary.mjs', 'tools/vocabulary.mjs']],
  ['platform', 'The platform as data', ['server/platform.mjs', 'tools/platform.mjs']],
  ['server', 'The server and its data sources', ['server/index.mjs', 'public/source.mjs']],
  ['contracts-view', 'The Contracts view', ['public/index.html', 'public/app.js']],
  ['graph-view', 'The Graph view', ['public/graph.html', 'public/graph.js']],
  ['levels-view', 'The Levels view', ['public/levels.html', 'public/levels.js', 'public/levels.mjs']],
  ['composer', 'The graphical composer', ['public/compose.html', 'public/composer.js']],
  ['demesnes', 'Demesnes and the Globe', ['public/space.mjs', 'public/globe.html', 'public/globe.js', 'public/example-demesnes.mjs']],
  ['guide', 'The reading guide and the style', ['public/guide.html', 'public/style.css']],
  ['publishing', 'Publishing', ['tools/build-static.mjs', '.github/workflows/pages.yml', '.github/ISSUE_TEMPLATE/proposition.yml', '.gitignore']],
  ['tests', 'Tests', [/^test\//]],
  ['docs', 'Documentation', ['README.md', 'CLAUDE.md', 'docs/nano-store.md', 'micro-social-contracts/README.md', '.claude/skills/write-with-picos/SKILL.md']],
  ['package', 'The package', ['package.json', 'package-lock.json']],
];
const serviceOf = path => SERVICES.find(([, , files]) => files.some(f => (f instanceof RegExp ? f.test(path) : f === path)))?.[0] ?? 'other';

// ─── Files ───────────────────────────────────────────────────────────────────

export function listFiles(root = ROOT) {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(path => path && !EXCLUDED.some(x => x.test(path)) && existsSync(join(root, path))).sort();
}

const LANGUAGE = { '.mjs': 'javascript', '.js': 'javascript', '.sql': 'sql', '.css': 'css', '.md': 'markdown', '.html': 'html',
                   '.json': 'json', '.yml': 'yaml' };
export const languageOf = path => LANGUAGE[posix.extname(path)] ?? 'text';

// ─── Splitting a file into units ─────────────────────────────────────────────
// Each unit runs from the end of the one before to the end of its own line (and a comment there), so they join exactly.

const lineEnd = (text, at, comment) => {
  const m = new RegExp(`^[ \\t]*(?:${comment}[^\\n]*)?\\r?\\n`).exec(text.slice(at, at + 400));
  return at + (m ? m[0].length : 0);
};

const names = p => (p.type === 'Identifier' ? [p.name]
  : p.type === 'ObjectPattern' ? p.properties.flatMap(q => names(q.type === 'RestElement' ? q.argument : q.value))
  : p.type === 'ArrayPattern' ? p.elements.filter(Boolean).flatMap(e => names(e.type === 'RestElement' ? e.argument : e))
  : p.type === 'AssignmentPattern' ? names(p.left) : []);

function declaration(node) {
  if (node.type === 'ImportDeclaration') return { form: 'import', name: node.source.value, declares: [] };
  const inner = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration' ? node.declaration : node;
  if (!inner) return { form: 'export', name: node.specifiers.map(s => s.exported.name ?? s.exported.value).join(', ') || null, declares: [] };
  if (inner.type === 'FunctionDeclaration' || inner.type === 'ClassDeclaration')
    return { form: inner.type === 'ClassDeclaration' ? 'class' : 'function', name: inner.id?.name ?? 'default', declares: inner.id ? [inner.id.name] : [] };
  if (inner.type === 'VariableDeclaration') {
    const declares = inner.declarations.flatMap(d => names(d.id));
    return { form: inner.kind, name: declares.join(', '), declares };
  }
  return { form: node.type === 'ExportDefaultDeclaration' ? 'export' : 'statement', name: null, declares: [] };
}

// Every identifier a piece of syntax mentions, apart from property names.
function mentioned(node, out = new Set()) {
  if (Array.isArray(node)) { for (const n of node) mentioned(n, out); return out; }
  if (!node || typeof node.type !== 'string') return out;
  if (node.type === 'Identifier') out.add(node.name);
  for (const [key, value] of Object.entries(node)) {
    if (!value || typeof value !== 'object') continue;
    if (!node.computed && ((node.type === 'MemberExpression' && key === 'property')
      || (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(node.type) && key === 'key'))) continue;
    mentioned(value, out);
  }
  return out;
}

function splitScript(text) {
  const program = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const units = [];
  let at = 0;
  for (const node of program.body) {
    const end = lineEnd(text, node.end, '//');
    units.push({ ...declaration(node), node, text: text.slice(at, end) });
    at = end;
  }
  if (at < text.length) units.push({ form: 'tail', name: null, declares: [], text: text.slice(at) });
  return units;
}

function sqlUnit(text) {
  const head = text.replace(/^(?:\s+|--[^\n]*\n?)*/, '');
  let m;
  if ((m = /^CREATE\s+(TABLE|TRIGGER|VIEW|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i.exec(head))) return { form: m[1].toLowerCase(), name: m[2], declares: [m[2]], text };
  if ((m = /^INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)/i.exec(head))) return { form: 'insert', name: m[1], declares: [], text };
  if ((m = /^DROP\s+\w+\s+(?:IF\s+EXISTS\s+)?(\w+)/i.exec(head))) return { form: 'drop', name: m[1], declares: [], text };
  if ((m = /^PRAGMA\s+(\w+)/i.exec(head))) return { form: 'pragma', name: m[1], declares: [], text };
  return { form: 'statement', name: null, declares: [], text };
}

function splitSql(text) {
  const units = [];
  let start = 0, depth = 0, i = 0;
  while (i < text.length) {
    if (text.startsWith('--', i)) { const j = text.indexOf('\n', i); i = j < 0 ? text.length : j; continue; }
    if (text[i] === "'") { const j = text.indexOf("'", i + 1); i = j < 0 ? text.length : j + 1; continue; }
    if (/[A-Za-z_]/.test(text[i]) && (i === 0 || !/\w/.test(text[i - 1]))) {   // BEGIN … END; wraps a trigger's semicolons
      const word = /^\w+/.exec(text.slice(i, i + 64))[0];
      if (word.toUpperCase() === 'BEGIN') depth++;
      else if (word.toUpperCase() === 'END' && depth > 0) depth--;
      i += word.length;
      continue;
    }
    if (text[i] === ';' && depth === 0) {
      const end = lineEnd(text, i + 1, '--');
      units.push(sqlUnit(text.slice(start, end)));
      start = i = end;
      continue;
    }
    i++;
  }
  if (start < text.length) units.push({ form: 'tail', name: null, declares: [], text: text.slice(start) });
  return units;
}

function splitCss(text) {
  const units = [];
  let start = 0, depth = 0, i = 0;
  while (i < text.length) {
    if (text.startsWith('/*', i)) { const j = text.indexOf('*/', i + 2); i = j < 0 ? text.length : j + 2; continue; }
    const c = text[i];
    if (c === '"' || c === "'") { let j = i + 1; while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1; i = j + 1; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) {
      const end = lineEnd(text, i + 1, '/\\*');
      const unit = text.slice(start, end);
      const prelude = unit.replace(/^(?:\s+|\/\*[\s\S]*?\*\/)*/, '');
      const name = prelude.slice(0, prelude.indexOf('{')).trim().replace(/\s+/g, ' ').slice(0, 80);
      units.push({ form: name.startsWith('@media') ? 'media' : name.startsWith('@') ? 'at-rule' : 'rule', name, declares: [], text: unit });
      start = i = end;
      continue;
    }
    i++;
  }
  if (start < text.length) units.push({ form: 'tail', name: null, declares: [], text: text.slice(start) });
  return units;
}

function splitMarkdown(text) {
  const starts = [0, ...[...text.matchAll(/^## /gm)].map(m => m.index).filter(at => at > 0)];
  return starts.map((s, i) => {
    const unit = text.slice(s, starts[i + 1] ?? text.length);
    return { form: 'section', name: /^#+ (.*)$/m.exec(unit)?.[1] ?? null, declares: [], text: unit };
  });
}

// A file's units, in order. Whatever the language, their texts joined are the file.
export function split(path, text) {
  const language = languageOf(path);
  let units;
  try {
    units = language === 'javascript' ? splitScript(text) : language === 'sql' ? splitSql(text) : language === 'css' ? splitCss(text)
      : language === 'markdown' ? splitMarkdown(text) : [{ form: 'document', name: null, declares: [], text }];
  } catch (err) {
    throw new Error(`${path}: ${err.message}`);
  }
  return units.map(u => ({ ...u, language }));
}

// ─── Identity and dependencies ───────────────────────────────────────────────

const slug = s => String(s).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  .replace(/[^a-z0-9.]+/g, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').slice(0, 60) || 'unit';
const pathId = path => slug(path.replace(/\//g, '.'));
export const fileId = path => `file.${pathId(path)}`;

// A unit's id: its file, its form and what it declares, numbered where one file has two alike.
function identify(file) {
  const seen = new Map();
  for (const u of file.units) {
    const base = `code.${pathId(file.path)}.${u.form}${u.name ? `-${slug(u.name)}` : ''}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    u.id = n === 1 ? base : `${base}-${n}`;
  }
}

const byTarget = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.relation < b.relation ? -1 : a.relation > b.relation ? 1 : 0);

// What each unit imports and uses: in JavaScript, the top-level names it mentions, its own file's or those it imports
// from the platform's other modules; in SQL, the tables and views it references.
function dependencies(files) {
  const declared = new Map(files.map(f => [f.path, new Map(f.units.flatMap(u => u.declares.map(name => [name, u.id])))]));
  for (const f of files) {
    const own = declared.get(f.path);
    if (f.language === 'javascript') {
      const imported = new Map();
      for (const u of f.units.filter(u => u.form === 'import')) {
        const spec = u.node.source.value;
        const theirs = spec.startsWith('.') && declared.get(posix.normalize(posix.join(posix.dirname(f.path), spec.split('?')[0])));
        u.depends = [];
        if (!theirs) continue;   // a package, not part of the platform
        for (const s of u.node.specifiers) {
          const id = s.type === 'ImportSpecifier' && theirs.get(s.imported.name ?? s.imported.value);
          if (id) { imported.set(s.local.name, id); u.depends.push({ id, relation: 'imports' }); }
        }
      }
      for (const u of f.units.filter(u => u.form !== 'import' && u.node)) {
        const ids = new Set();
        for (const name of mentioned(u.node)) {
          const id = u.declares.includes(name) ? null : own.get(name) ?? imported.get(name);
          if (id && id !== u.id) ids.add(id);
        }
        u.depends = [...ids].map(id => ({ id, relation: 'uses' }));
      }
    } else if (f.language === 'sql') {
      for (const u of f.units) {
        const ids = new Set();
        for (const m of u.text.replace(/--[^\n]*/g, '').matchAll(/\b(?:REFERENCES|ON|FROM|JOIN|INTO)\s+(\w+)/gi)) {
          const id = own.get(m[1]);
          if (id && id !== u.id) ids.add(id);
        }
        u.depends = [...ids].map(id => ({ id, relation: 'uses' }));
      }
    }
    for (const u of f.units) { u.depends = (u.depends ?? []).sort(byTarget); delete u.node; }
  }
}

// ─── Extracting into the store, and rebuilding from it ───────────────────────

const head = root => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { return 'no commit'; } };
const latestOf = list => { const by = new Map(); for (const x of list) if (!by.has(x.id) || by.get(x.id).rev < x.rev) by.set(x.id, x); return by; };
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const dependsKey = list => JSON.stringify([...list].sort(byTarget).map(d => [d.id, d.relation]));
const picosKey = list => JSON.stringify(list.map(p => `${p.phrase}>${String(p.pico).split('@')[0]}`).sort());

// Write new revisions for whatever changed in the repository: its units, the files that hold them, the services that
// include the files, and the application. What didn't change keeps its revision, so a second run writes nothing.
export function extract(db, { root = ROOT } = {}) {
  const files = listFiles(root).map(path => ({ path, language: languageOf(path), units: split(path, readFileSync(join(root, path), 'utf8')) }));
  files.forEach(identify);
  dependencies(files);

  return db.transaction(() => {
    addVocabulary(db, 'author', ...AUTHOR);
    const by = { filedBy: AUTHOR[0], source: `the repository at ${head(root)} and its working tree` };
    const cat = catalogue(db);
    const nanos = latestOf(Object.values(cat.nanos)), contracts = latestOf(Object.values(cat.contracts));
    const vocabulary = contracts.get('vocabulary');
    const picos = (vocabulary?.members ?? []).map(ref => nanos.get(ref.split('@')[0])).filter(n => n?.kind === 'definition')
      .map(p => ({ ref: p.ref, forms: p.forms }));
    let written = 0;

    // Units: a new revision only where the text, the form, the name, the dependencies or the words used changed.
    const unitRef = new Map();
    for (const u of files.flatMap(f => f.units)) {
      const refs = suggest(u.text, picos);
      const current = nanos.get(u.id);
      if (current?.kind === 'unit' && current.text === u.text && current.form === u.form && (current.name ?? null) === (u.name ?? null)
        && current.language === u.language && dependsKey(current.depends) === dependsKey(u.depends) && picosKey(current.picos) === picosKey(refs)) {
        unitRef.set(u.id, current.ref);
        continue;
      }
      unitRef.set(u.id, addNano(db, { id: u.id, kind: 'unit', form: u.form, name: u.name ?? null, language: u.language, text: u.text,
                                      depends: u.depends, picos: refs, ...by }).ref);
      written++;
    }

    // Files: each a micro holding its units in order.
    const fileRef = new Map();
    for (const f of files) {
      const id = fileId(f.path), members = f.units.map(u => unitRef.get(u.id)), current = contracts.get(id);
      if (current && current.status !== 'retired' && current.title === f.path && sameList(current.members, members)) { fileRef.set(f.path, current.ref); continue; }
      fileRef.set(f.path, addContract(db, { id, scale: 'micro', title: f.path, members, ...by }).ref);
      written++;
    }

    // Services: each a micro including its files. Then the application, including every service and the vocabulary.
    const services = [];
    for (const [key, title] of [...SERVICES, ['other', 'Other files']]) {
      const paths = files.map(f => f.path).filter(p => serviceOf(p) === key);
      if (!paths.length) continue;
      const id = `service.${key}`, includes = paths.map(p => fileRef.get(p)), current = contracts.get(id);
      if (current && current.status !== 'retired' && current.title === title && sameList(current.includes.map(i => i.ref).sort(), [...includes].sort())) {
        services.push({ contract: current.ref, mode: 'add' });
        continue;
      }
      services.push({ contract: addContract(db, { id, scale: 'micro', title, includes: includes.map(ref => ({ contract: ref, mode: 'add' })), ...by }).ref, mode: 'add' });
      written++;
    }
    const includes = [...(vocabulary ? [{ contract: vocabulary.ref, mode: 'add', base: true }] : []), ...services];
    const app = contracts.get('social-contract-composer');
    const key = list => list.map(i => `${i.ref ?? i.contract}${i.base ? '*' : ''}`).sort().join();
    if (!app || key(app.includes) !== key(includes)) {
      addContract(db, { id: 'social-contract-composer', scale: 'social', title: 'Social Contract Composer', includes, ...by });
      written++;
    }

    // Files and services that are gone: retired by a new revision, never deleted.
    const present = new Set([...files.map(f => fileId(f.path)), ...services.map(s => s.contract.split('@')[0])]);
    for (const c of contracts.values())
      if ((c.id.startsWith('file.') || c.id.startsWith('service.')) && c.status !== 'retired' && !present.has(c.id)) {
        reviseContract(db, c.id, { status: 'retired', ...by });
        written++;
      }
    return { written, files: files.length, units: unitRef.size };
  })();
}

// Every file, rebuilt from the store: the units its latest file micro holds, joined in order.
export function rebuild(db) {
  const cat = catalogue(db);
  const files = new Map();
  for (const c of latestOf(Object.values(cat.contracts)).values())
    if (c.id.startsWith('file.') && c.status !== 'retired') files.set(c.title, c.members.map(ref => cat.nanos[ref].text).join(''));
  return files;
}

// How the store and the working tree differ: files it lacks, files it has that are gone, and files that differ.
export function compare(db, root = ROOT) {
  const built = rebuild(db), paths = listFiles(root);
  return {
    missing: paths.filter(p => !built.has(p)),
    stale: [...built.keys()].filter(p => !paths.includes(p)),
    mismatched: paths.filter(p => built.has(p) && built.get(p) !== readFileSync(join(root, p), 'utf8')),
  };
}
