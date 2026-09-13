# Social Contract Composer

A catalogue of **micro-social-contracts**: small agreements that each cover one area of life. Anyone can pick a set of them and combine the set into a full Social Contract for a society they want to write down.

Contracts are built from **nanos**, small reusable parts stored once in one database:

- **Intents** — purposes anyone can grasp directly ("To protect mothers")
- **Clauses** — the actual agreements
- **Definitions**, **parameters**, **measures** and **assumptions**
- **Claims** — how a clause is believed to serve an intent, and the context that belief depends on

The composer doesn't judge which contracts are right. It shows what a composition *claims* to satisfy, where its claims pull against each other, where two claims disagree and exactly why, and what is left uncovered. Claims are put up for evaluation: a society that adopts a contract tests them.

**Live:** https://jjokulian.github.io/social-contract-composer/ (the static build; see below).
**Reading guide:** [How to Read a Contract](https://jjokulian.github.io/social-contract-composer/guide.html). It applies to every contract in the catalogue.
**Compose:** [drag and drop your own Social Contract](https://jjokulian.github.io/social-contract-composer/compose.html). Combine contracts and nanos, attach consequences of breach, watch the live report, and submit the result as a doubt.
The design is in [docs/nano-store.md](docs/nano-store.md).

## Run it

```sh
npm install
npm start          # http://127.0.0.1:8800 — set PORT to change it
npm test
```

The API is read-only by default. `COMPOSER_ALLOW_WRITES=1 npm start` enables `POST /api/nanos` and `POST /api/contracts`.

### Static build (GitHub Pages)

```sh
npm run build:static   # writes dist/: the client, plus one snapshot per contract baked from the store
```

`.github/workflows/pages.yml` runs the tests, builds `dist/` and deploys it on every push to `main`. The page asks `api/config` whether a server exists. If it gets a 404, it reads the baked snapshots instead. Either way, the report is computed in the browser by `public/evaluate.mjs`, the same module the server uses.

| Capability | Static site |
|---|---|
| Contracts, societies, the full composition report | Works: baked snapshots, evaluated in the browser |
| Parameter sliders and societies | Works: evaluated in the browser, at any value |
| `GET /api/nanos/:ref`, `/report`, `/snapshot` | Server only: the page doesn't call them |
| Writing nanos and contracts | Server only: a static host can't record shared state |

### Git diffs of the store

The store is `store/composer.sqlite`. To make `git diff` show changes to it as text, run this once per clone:

```sh
git config diff.sqlite.textconv "node tools/sqlite-dump.mjs"
```

## Layout

```
store/schema.sql         tables, integrity triggers and composition views
store/composer.sqlite    the store: every nano, claim and contract
server/store.mjs         read and write nanos and contracts
server/checks.mjs        snapshot a composition out of the store
server/index.mjs         JSON API and static client
public/evaluate.mjs      evaluate a snapshot into the report; shared by the server and the browser
public/                  the composer client
tools/build-static.mjs   the static build for GitHub Pages
micro-social-contracts/  contract-specific material that isn't store data (views, explorers)
test/                    a neutral toy composition that exercises every check
docs/                    design
```

## Catalogue

| Contract | Status | Top intents |
|---|---|---|
| pro-pregnancy | draft | To protect mothers · To protect babies · To hallow new human life · To make pregnancy a delight |
