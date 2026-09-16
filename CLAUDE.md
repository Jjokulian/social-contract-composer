# Social Contract Composer: notes for Claude

A composer of social contracts. The scale: a **milli** is a composed Social Contract; it is made of **micros** (micro-social-contracts, e.g. `pro-pregnancy`); those are made of **nanos** (intents, clauses, claims, measures, assumptions, influences, consequences…); nanos use **picos**, strictly defined words. See `docs/nano-store.md` for the design and `public/guide.html` for how contracts are read.

## Where things are

- `store/composer.sqlite`: the store, and the only copy of the data. `store/schema.sql` has the schema and integrity triggers.
- `store/system.sqlite`: the platform's own store, in the same schema: the composer's vocabulary (the `vocabulary` micro) and the `social-contract-composer` application milli. In software terms a pico is a logical unit, a nano a functional unit, a micro a service, a milli an application and a demesne its implementation. The server reads it with `?store=system` on any route, the static build bakes it into `dist/data/system/`, and the Contracts and Graph views switch to it with their Store control.
- `server/store.mjs`: read and write nanos and contracts; `reviseContract` derives a contract's next revision from its current one.
- `public/compose.mjs`, `public/evaluate.mjs`, `public/picos.mjs`: pure modules shared by the server, the static build and the browser.
- `tools/build-static.mjs` + `.github/workflows/pages.yml`: the GitHub Pages site, deployed on every push to `main`.
- `tools/picos.mjs`: list, find and check picos (see the `write-with-picos` skill).
- `public/levels.mjs` + `levels.html`: the Levels view, every milli, micro, nano and pico of a store as one graph with the relations between them (includes, operators, holds, refines, uses, claims, influences, breaches, precedence), filtered by level and relation; a hidden level is crossed, not cut.
- `docs/composition.md`: the declared rules a composition is resolved by (precedence, reach, operators, settings), like a linker specification. Changing `public/compose.mjs` means changing that spec with it; the tests check that the order of includes never matters.
- Composition operators (`contract_operation`: abrogate, derogate, subrogate, obrogate) and resolution maxims (`contract_resolution`: superior, specialis, posterior) are applied in `public/compose.mjs` and `public/evaluate.mjs`; nothing an operator acts on is deleted from view.
- Socioship (having signed a milli) is structure, not content: `socioship_term` lists the terms every milli defines and `contract_socioship` which of its nanos define them. Never store it as a contract.
- `public/space.mjs`: demesnes. A signed milli implemented on a segment of a coordinate space is a demesne (`demesne_rev`), not a nano; its deme is whoever the milli defines as the deme, and demesnes within a demesne can have different demes. How demesnes nest is computed, never stored. A layer is a viewing selection (a nesting level, or one milli's demesnes), shown or hidden on the Globe (`public/globe.js`). A demesne revision may record the period it is in force and the demesne it came after; succession is never continuity, so a successor is another demesne. `?when=` on the Globe layers only what was in force at that instant. The Timeline (`public/time.html` + `public/time.js`, with `public/timeline.mjs` for the maths and `public/map.mjs` for what it draws with, shared with the Globe) drags through those instants: its strip counts what was in force at each nesting level and marks every beginning, ending and succession.

## Rules

- **The store is append-only.** Change a contract with a new revision (`addNano` for a new nano revision, `reviseContract` for the contract); never update or delete rows.
- **Use the authors' words.** Intents, definitions and clauses go in as the authors give them. Relations you draft (claims, influences, assumptions) are filed by `claude-draft`, with a rationale.
- **Don't invent means.** An intent the authors haven't given clauses for stays a visible gap; ask instead of filling it.
- **Keep one-off revision scripts out of the repo.** The store is the record; describe each revision in its commit message.
- **Write with picos.** A nano records which picos its words refer to when it is written, and that never changes. A new or revised pico doesn't change existing nanos; to adopt it, write new revisions of them. Whenever you write or revise text in the store, follow `.claude/skills/write-with-picos/SKILL.md`.
- **The composer's words live in the system store.** The guide's glossary is rendered from the vocabulary picos in `store/system.sqlite`; never edit it by hand. To change a word, write a new revision of its pico there, relink (`COMPOSER_STORE=system node tools/picos.mjs relink vocabulary`), and run `node tools/vocabulary.mjs render`.
- **The platform is data.** Every source file is split into units in `store/system.sqlite` (`server/platform.mjs`), so the store rebuilds the repository byte for byte. Before committing, run `node tools/platform.mjs extract`; the tests fail if the store and the working tree differ, and a second extraction must write nothing. A new file joins a service in `SERVICES` (otherwise it lands in "Other files"). The extractor reads only tracked files, so `git add` a new file **before** extracting; otherwise the store misses it, and the tests fail once it is committed.
- Before committing: `node tools/platform.mjs extract`, `npm test` and `npm run build:static`.
