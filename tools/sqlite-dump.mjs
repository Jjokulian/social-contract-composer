#!/usr/bin/env node
// Print a SQLite database as deterministic text, so `git diff` shows what changed in the store.
// Enable once per clone:  git config diff.sqlite.textconv "node tools/sqlite-dump.mjs"
import Database from 'better-sqlite3';

const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });
const tables = db.prepare(
  "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).pluck().all();

for (const table of tables) {
  const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY 1, 2`).all();
  if (!rows.length) continue;
  console.log(`\n## ${table}`);
  for (const row of rows) console.log(JSON.stringify(row));
}
