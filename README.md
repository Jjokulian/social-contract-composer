# Social Contract Composer

A catalogue of **micro-social-contracts**: small agreements that each cover one area of life. Anyone can pick a set of them and combine the set into a full Social Contract for a society they want to write down.

Contracts are built from **nanos**, small reusable parts stored once in one database:

- **Intents** — purposes anyone can grasp directly ("To protect mothers")
- **Clauses** — the actual agreements
- **Definitions**, **parameters**, **measures** and **assumptions**
- **Claims** — how a clause is believed to serve an intent, and the context that belief depends on

The composer doesn't judge which contracts are right. It shows what a composition *claims* to satisfy, where its claims pull against each other, where two claims disagree and exactly why, and what is left uncovered. Claims are put up for evaluation: a society that adopts a contract tests them.

The design is in [docs/nano-store.md](docs/nano-store.md).

## Run it

```sh
npm install
npm start          # http://127.0.0.1:8800 — set PORT to change it
npm test
```

The API is read-only by default. `COMPOSER_ALLOW_WRITES=1 npm start` enables `POST /api/nanos` and `POST /api/contracts`.

The store is `store/composer.sqlite`. To make `git diff` show changes to it as text, run this once per clone:

```sh
git config diff.sqlite.textconv "node tools/sqlite-dump.mjs"
```

## Layout

```
store/schema.sql         tables, integrity triggers and composition views
store/composer.sqlite    the store: every nano, claim and contract
server/store.mjs         read and write nanos and contracts
server/checks.mjs        the composition report
server/index.mjs         JSON API and static client
public/                  the composer client
micro-social-contracts/  contract-specific material that isn't store data (views, explorers)
test/                    a neutral toy composition that exercises every check
docs/                    design
```

## Catalogue

| Contract | Status | Top intents |
|---|---|---|
| pro-pregnancy | draft | To protect mothers · To protect babies · To hallow new human life · To make pregnancy a delight |
