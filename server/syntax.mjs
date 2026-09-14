// What compilers know about syntax, put to use by the extractor (server/platform.mjs).
//
//   freeNames  the names a top-level statement refers to without binding them itself, resolved through the scopes a
//              compiler builds (parameters, local declarations, catch clauses, nested functions and classes). A local
//              name that happens to match a top-level one is never taken for a dependency.
//   shapeOf    a unit's shape: its tokens without comments or layout, with the names it declares replaced by one
//              placeholder. Two units with one shape are the same code, renamed or moved: identity by content, as in
//              content-addressed languages like Unison, while ids stay readable names.
import { createHash } from 'node:crypto';
import * as acorn from 'acorn';

const isFunction = n => n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';

// The names a binding pattern declares: x, { a, b: c }, [d, ...e], f = 1.
export const bindingNames = p => (!p ? []
  : p.type === 'Identifier' ? [p.name]
  : p.type === 'ObjectPattern' ? p.properties.flatMap(q => bindingNames(q.type === 'RestElement' ? q.argument : q.value))
  : p.type === 'ArrayPattern' ? p.elements.flatMap(e => bindingNames(e && (e.type === 'RestElement' ? e.argument : e)))
  : p.type === 'AssignmentPattern' ? bindingNames(p.left)
  : p.type === 'RestElement' ? bindingNames(p.argument) : []);

// Names hoisted to a function's scope: its var declarations anywhere outside nested functions.
function hoisted(body) {
  const out = [];
  const walk = n => {
    if (!n || typeof n.type !== 'string' || isFunction(n)) return;
    if (n.type === 'VariableDeclaration' && n.kind === 'var') for (const d of n.declarations) out.push(...bindingNames(d.id));
    for (const v of Object.values(n)) if (v && typeof v === 'object') (Array.isArray(v) ? v : [v]).forEach(walk);
  };
  (Array.isArray(body) ? body : [body]).forEach(walk);
  return out;
}

// Names a block declares directly: let, const, class, and (in a module, which is strict) function declarations.
function declaredIn(statements) {
  const out = [];
  for (const s of statements) {
    const d = s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration' ? s.declaration : s;
    if (!d) continue;
    if (d.type === 'VariableDeclaration' && d.kind !== 'var') for (const v of d.declarations) out.push(...bindingNames(v.id));
    if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) out.push(d.id.name);
  }
  return out;
}

export function freeNames(root) {
  const free = new Set();
  const scope = (parent, names) => ({ parent, names: new Set(names) });
  const bound = (name, s) => { for (; s; s = s.parent) if (s.names.has(name)) return true; return false; };

  // A pattern in a binding position: its names are declared, not referred to; only defaults and computed keys refer.
  const pattern = (p, s) => {
    if (!p) return;
    if (p.type === 'AssignmentPattern') { pattern(p.left, s); visit(p.right, s); }
    else if (p.type === 'ObjectPattern') for (const q of p.properties) {
      if (q.type === 'RestElement') pattern(q.argument, s);
      else { if (q.computed) visit(q.key, s); pattern(q.value, s); }
    }
    else if (p.type === 'ArrayPattern') for (const e of p.elements) pattern(e, s);
    else if (p.type === 'RestElement') pattern(p.argument, s);
    else if (p.type !== 'Identifier') visit(p, s);   // an assignment target such as a.b
  };
  const block = (statements, s) => {
    const inner = scope(s, declaredIn(statements));
    for (const st of statements) visit(st, inner);
  };
  const fn = (n, s) => {
    const own = n.type === 'FunctionExpression' && n.id ? [n.id.name] : [];
    const body = n.body.type === 'BlockStatement' ? n.body.body : null;
    const inner = scope(s, [...own, 'arguments', ...n.params.flatMap(bindingNames), ...(body ? [...hoisted(body), ...declaredIn(body)] : [])]);
    for (const p of n.params) pattern(p, inner);
    if (body) for (const st of body) visit(st, inner); else visit(n.body, inner);
  };

  function visit(n, s) {
    if (!n || typeof n.type !== 'string') return;
    switch (n.type) {
      case 'Identifier': if (!bound(n.name, s)) free.add(n.name); return;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': fn(n, s); return;
      case 'ClassDeclaration': case 'ClassExpression': {
        const inner = n.id ? scope(s, [n.id.name]) : s;
        visit(n.superClass, s);
        for (const m of n.body.body) {
          if (m.type === 'StaticBlock') { block(m.body, inner); continue; }
          if (m.computed) visit(m.key, inner);
          visit(m.value, inner);
        }
        return;
      }
      case 'BlockStatement': case 'StaticBlock': block(n.body, s); return;
      case 'VariableDeclaration': for (const d of n.declarations) { pattern(d.id, s); visit(d.init, s); } return;
      case 'CatchClause': {
        const inner = scope(s, bindingNames(n.param));
        pattern(n.param, inner);
        block(n.body.body, inner);
        return;
      }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
        const head = n.init ?? n.left;
        const inner = head?.type === 'VariableDeclaration' && head.kind !== 'var' ? scope(s, head.declarations.flatMap(d => bindingNames(d.id))) : s;
        if (n.left && n.left.type !== 'VariableDeclaration') pattern(n.left, inner); else visit(head, inner);
        for (const k of ['test', 'update', 'right', 'body']) visit(n[k], inner);
        return;
      }
      case 'SwitchStatement': {
        visit(n.discriminant, s);
        const inner = scope(s, n.cases.flatMap(c => declaredIn(c.consequent)));
        for (const c of n.cases) { visit(c.test, inner); for (const st of c.consequent) visit(st, inner); }
        return;
      }
      case 'MemberExpression': visit(n.object, s); if (n.computed) visit(n.property, s); return;
      case 'Property': case 'PropertyDefinition': case 'MethodDefinition': if (n.computed) visit(n.key, s); visit(n.value, s); return;
      case 'LabeledStatement': visit(n.body, s); return;
      case 'BreakStatement': case 'ContinueStatement': case 'MetaProperty': case 'ImportDeclaration': return;
      default:
        for (const [key, v] of Object.entries(n))
          if (key !== 'loc' && v && typeof v === 'object') (Array.isArray(v) ? v : [v]).forEach(x => visit(x, s));
    }
  }
  visit(root, scope(null, []));
  return free;
}

// A unit's shape: the same for the same code, whatever it is called, wherever it sits, however it is laid out.
export function shapeOf(text, language, declares = []) {
  const own = new Set(declares);
  let normal = null;
  if (language === 'javascript') {
    try {
      const tokens = [];
      for (const t of acorn.tokenizer(text, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }))
        tokens.push(t.type.label === 'name' && own.has(t.value) ? '§' : text.slice(t.start, t.end));
      if (tokens[0] === 'export') tokens.splice(0, tokens[1] === 'default' ? 2 : 1);   // exporting it doesn't change the code
      normal = tokens.join(' ');
    } catch { /* not a whole statement on its own: fall back to its words */ }
  }
  normal ??= text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)(?:--|\/\/)[^\n]*/g, '$1')
    .split(/(\w+)/).map(w => (own.has(w) ? '§' : w)).join('').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(`${language}\n${normal}`).digest('hex').slice(0, 24);
}
