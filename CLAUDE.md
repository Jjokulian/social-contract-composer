# Social Contract Composer: notes for Claude

A composer of social contracts. The scale: a **milli** is a composed Social Contract; it is made of **micros** (micro-social-contracts, e.g. `pro-pregnancy`); those are made of **nanos** (intents, clauses, claims, measures, assumptions, influences, consequences…); nanos use **picos**, strictly defined words. See `docs/nano-store.md` for the design and `public/guide.html` for how contracts are read.

## Where things are

- `store/composer.sqlite`: the store, and the only copy of the data. `store/schema.sql` has the schema and integrity triggers.
- `server/store.mjs`: read and write nanos and contracts; `reviseContract` derives a contract's next revision from its current one.
- `public/compose.mjs`, `public/evaluate.mjs`, `public/picos.mjs`: pure modules shared by the server, the static build and the browser.
- `tools/build-static.mjs` + `.github/workflows/pages.yml`: the GitHub Pages site, deployed on every push to `main`.
- `tools/picos.mjs`: list, find and check picos (see the `write-with-picos` skill).

## Rules

- **The store is append-only.** Change a contract with a new revision (`addNano` for a new nano revision, `reviseContract` for the contract); never update or delete rows.
- **Use the authors' words.** Intents, definitions and clauses go in as the authors give them. Relations you draft (claims, influences, assumptions) are filed by `claude-draft`, with a rationale.
- **Don't invent means.** An intent the authors haven't given clauses for stays a visible gap; ask instead of filling it.
- **Keep one-off revision scripts out of the repo.** The store is the record; describe each revision in its commit message.
- **Write with picos.** Whenever you write or revise text in the store, follow `.claude/skills/write-with-picos/SKILL.md`.
- Before committing: `npm test` and `npm run build:static`.
