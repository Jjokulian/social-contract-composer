# Nano store — design

*Status: implemented and live at https://jjokulian.github.io/social-contract-composer/, except for the GitHub Issues contribution flow.*

## The idea

Agreements are built from **nanos**: small parts, each stored once and reused by any number of micro-contracts and Social Contracts. At the top of every contract sit **intents** that people can grasp directly ("To protect mothers"). Below them sit **clauses**, the actual agreements. What joins them are **claims**: "in this context, this clause supports (or hinders) that intent, for this reason, and here is how you would check."

A claim is never true or false on its own. It is true or false **in a context**: the other clauses around it, the parameter values adopters chose, and assumptions about the society that adopts it. The context is written into the claim, so the composer can work out *where two claims part ways* when they use the same nanos and reach different conclusions. That difference is the agenda for investigation or debate, and at the very least a visible view of the disagreement.

The composer never solves for anything. It takes a given composition and computes what it claims to satisfy, where its claims disagree and why, what is uncovered, and what conflicts. Every check is a single pass or a pairwise comparison, so there is no satisfiability search anywhere.

## Levels

```
Social Contract          a composition of contracts (nested under an intent, or added alongside)
└─ micro-social-contract an intent tree + the nanos that serve it
   └─ nano               an intent, clause, definition, parameter, measure, assumption, claim, influence or evaluation
```

## Architecture

A normal server over one normalized database. Every fact is recorded once, and every reference is a foreign key.

| Part | Role |
|---|---|
| `store/schema.sql` | Tables and integrity triggers; composition is computed in `public/compose.mjs` |
| `store/composer.sqlite` | The store. It's committed, and `tools/sqlite-dump.mjs` makes its git diffs readable |
| `server/store.mjs` | Writes nanos and contracts in single transactions; reads them with references rendered as `id@rev` |
| `server/checks.mjs` | Snapshots a composition: everything in scope for one contract, as plain JSON |
| `public/evaluate.mjs` | Turns a snapshot into the composition report. Pure JavaScript, shared by the server and the browser |
| `server/index.mjs` | JSON API plus the static client |

The report is split in two:
- **Snapshot** (SQL): what is in scope. It depends only on the contract, so it can be baked.
- **Evaluate** (pure): conditions, rollup and disagreement classification at the chosen parameter values and society. The parameter combinations are far too many to bake, so this part runs wherever the page runs.

The static build (`tools/build-static.mjs`, deployed by `.github/workflows/pages.yml`) ships one snapshot per contract. The client asks `api/config` whether a server exists, and a 404 switches it to the baked snapshots. Writes stay server-only.

### What the schema enforces

- **Append-only.** Nano and contract revisions can't be updated or deleted. A change is a new revision, numbered consecutively, and references pin `id@rev`.
- **Kinds.** Body rows must match their revision's kind. `supports` and `hinders` go clause → intent; `conflicts` go between clauses or definitions. A claim's conditions reference parameters, its assumptions reference assumptions, and so on.
- **Domains.** A contract's parameter values must fall inside the parameter's range.
- **No cycles.** A contract can include only earlier contract revisions.
- **Normalization.** Authors, roles, terms, units and societies are vocabularies. Nesting lives in the contract (`contract_intent`, `contract_refines`), never in the nanos, so an intent can sit under different parents in different contracts. Roots are derived, not stored.

## Claims carry their context

| Field | Meaning |
|---|---|
| `from`, `relation`, `to`, `strength` | e.g. *plant-trees supports shade-walkers (sufficient)* |
| `given` | Nanos that must be in the composition for the claim to apply |
| `when` | Conditions on parameter values, e.g. `tree-spacing <= 15` |
| `assuming` | Beliefs about the society, as conditions on measures where possible |
| `measuredBy` | How a society would check it |
| `rationale`, `filedBy`, `source` | Why, who, and where it came from |

A claim **applies** when all of its `given` nanos are present, its `when` conditions hold at the chosen values, and no `assuming` condition is contradicted by the society's evaluations. Its status is one of *applies*, *unverified* (applies, but nothing has tested its assumptions), *inactive* (a condition doesn't hold), or *contradicted*.

### Disagreements

Two claims disagree when they share `from` and `to` but differ in `relation` or `strength`. The composer compares their contexts and classifies the pair:

| Class | Meaning | What settles it |
|---|---|---|
| **Conditional** | They hold at disjoint parameter values | Nothing to settle: the adopters' choice decides |
| **Crux on assumption** | They assume disjoint values of one measure | An evaluation of that measure, per society |
| **Direct** | Identical contexts, opposite conclusions | Debate about the reasoning and evidence |
| **Divergent context** | One considers nanos the other ignores | Whether those nanos belong in the picture |

Conditions are simple comparisons against a constant, so "disjoint?" is interval arithmetic.

### Influences

An **influence** records that one measure *raises*, *lowers*, *bears on* or *stands in for* another measure or an intent. Examples: *environmental load lowers the baby's development rate*, and *weeks since the last menstrual period stand in for development*. Like a claim, it is attributed and open to evaluation, but it doesn't assert that it's true, and it never counts towards coverage. It shows what bears on what, so each group can decide which influences it believes. An influence is in scope when both of its ends are in the composition.

## The composition report

`GET /api/contracts/:ref/report?society=<id>&p.<parameter>=<value>`

- **Tree** — every intent, with its *coverage* rolled up through *all of* / *any of*: *claimed* (a sufficient claim, or children that are covered), *thin* (only contributing claims) or *gap*. It is also flagged *in tension* (the contract's own claims hinder it), *challenged* (claims the contract doesn't endorse hinder it) and *disputed* (claims about it disagree).
- **Conflicts** — conflicts claims whose two ends are both in the composition.
- **Definition clashes** — two definitions of one term.
- **Gaps and thin** — the intents at those coverage levels.
- **Orphans** — clauses that serve no intent, either directly or as a precondition.
- **Tensions** — clauses that support one intent and hinder another.
- **Disagreements** — with their context diff and class.

## The platform's own store

All content is one database (`store/composer.sqlite`); the platform's own structure is another (`store/system.sqlite`), in the same schema, read by the same tools. In software terms a pico is a logical unit, a nano a functional unit, a micro a service, a milli an application, and a demesne its implementation on real machines.

The viewer reads either store the same way: the server takes `?store=system` on every route, the static build bakes the system store into `data/system/`, and the Contracts and Graph views have a Store switch. The system store holds the composer's vocabulary as picos (the `vocabulary` micro), included as the base of the `social-contract-composer` milli. The guide's glossary is rendered from them (`tools/vocabulary.mjs`), and a test fails if the two differ, so a word is changed once, as a new pico revision, never by editing text around the repository. The authors' own definitions came over verbatim from the catalogue with their attribution; the rest are drafted from their words and filed by `claude-draft`.

The platform's software is in the store too (`server/platform.mjs`, `tools/platform.mjs`). Every source file is split into units (kind `unit`): each top-level statement of a module, each SQL statement, each CSS rule, each section of a Markdown document, or the whole file where it has no smaller parts. Each unit holds its exact text, with the whitespace and comments before it, and records what it imports and uses (`unit_depends`, by the other unit's id). A file is a micro holding its units in order; a service is a micro including its files; the application milli includes the services, with the vocabulary as its base. A unit that declares something and depends on nothing is a logical unit, drawn at the pico level; one that uses others is a functional unit, a nano. The extractor applies what compilers know about syntax (`server/syntax.mjs`): dependencies are resolved through the scopes a compiler builds, so a local name never counts as a use of a top-level one; a file's opening comment is a unit of its own; and a unit's shape (its tokens without comments or layout, its own name replaced) identifies it by content, so a unit that disappears from every file while its shape lives on elsewhere is recorded as renamed or moved (`unit_moved`), and whatever it implemented follows it. Copies that differed a little (a default, a narrower signature) and were replaced by one shared definition (`public/common.mjs`) have no one shape, so a digest declares the merge instead, with its reason, as a linker takes a declared alias; and it drops from a pico the code that now only uses it. Traversing the store rebuilds the repository byte for byte, and the tests check it, including the files that do the rebuilding: a data-structured quine. Extraction writes new revisions only for what changed, so a second run writes nothing. The stores themselves are outputs, never sources.

Definitions refer to one another in cycles, so pinned references among them can't all be current at once. A contract keeps the meaning it was written with, because signatures rest on it; the platform's own copy has no signatures, so it renders each linked word with its pico's latest revision.

## Operators and resolution

How a composition is resolved, with precedence, reach, operators and settings, is specified in `docs/composition.md`. It never depends on the order of includes.

A composition acts on what it includes with the operators Roman law named: it **abrogates** a whole included contract, **derogates** one of its nanos, **subrogates** a nano into it, or **obrogates** one of its nanos with another (`contract_operation`, optionally citing the nano whose words make the operation). Rogation and nesting are `contract_include`, where one include can be marked the **base**. Nothing is deleted: the composition shows what each operator acts on, struck through. Operators can't act on intents; an intent changes by a new revision of the contract.

Conflicts no operator settles are resolved by the maxims the composition states, in its order (`contract_resolution`): **lex superior** (what comes through the base outranks), **lex specialis** (the nano the composition declares special, in `contract_specialis`, prevails) and **lex posterior** (what the later-composed contract brings prevails). The losing side is set aside: its claims stop counting towards coverage. With no maxim deciding, the conflict stays open and both sides stand.

## Socioship: structure every milli fills

Socioship is the relation of having signed a milli together with other persons. It is structure, not content: no contract holds it. `socioship_term` lists the terms every milli defines (how a new signature takes effect, how the born join, the conditions of socioship, how it is lost, what is kept, who the deme is), and `contract_socioship` records which of a milli's clauses or definitions define each. A trigger refuses them on a micro. The composition carries each term from the outermost contract that defines it; the report marks it defined, held by its default (only admission has one: every signatoree signs too), or a gap. A clause that defines a term serves the milli's structure, so it is never an orphan.

## Demesnes: millis implemented on coordinate spaces

Picos, nanos, micros and millis are virtual: they take up no space. A milli defines an entire society; persons who sign it make a socioship, defined fully by its milli. When they implement it on a **segment** of a **coordinate space** (Earth in longitude and latitude, or any other body in its own frame), that is a **demesne**. Its **deme** is whoever its milli defines as the deme. The deme of one layer is not the deme of another: demesnes within a demesne can have different demes.

- `space`: the coordinate spaces, each with the frame its coordinates are in.
- `demesne` / `demesne_rev`: each revision pins one milli revision and one segment (a GeoJSON Polygon or MultiPolygon) in one space. A trigger refuses a micro: it is composed into a milli first. Revisions are append-only, so a demesne that grows, shrinks or adopts a newer revision of its milli keeps its history. Who is in a demesne's deme, and who are its citizens, is not recorded. A revision may also record the period it is in force — from an instant until another, either end open, each written as coarsely as the record allows (`1789`, `1789-04-30`, or `-0323` for 323 BC) — and the demesne it came **after**. That is succession, never continuity: a successor is another demesne, whose deme signs afresh, and the store records only what followed what.
- Nesting is never stored. `public/space.mjs` computes, from the segments, which demesnes lie within which (their nesting level), which overlap and which only border each other, and whether the demesnes directly within one segment it exhaustively or cover a share of it as islands. A lookup of a point or an area of interest lists every demesne stacked there, from the outermost to the innermost. Given an instant (`?when=1789-04-30` on the Globe, or on `/api/spaces/:space/layering`), only the demesnes in force then are layered, so the nesting shown is the nesting as it was then.
- A **layer** is what a viewer shows or hides: every demesne at one nesting level, or every demesne of one milli. The Globe gives each shown layer its own ground pattern and colours neighbouring demesnes within a layer differently; hiding the layers above frees their patterns for the layers below.

Edges are straight in the space's frame, so a segment crossing the antimeridian is written as two polygons.

## Contributions through GitHub Issues (planned)

1. **Propose.** Anyone opens an issue from a form: *propose a nano*, *file a claim* or *report an evaluation*.
2. **Show.** The client shows open proposals next to the store, marked as proposals. Proposed claims take part in disagreement reports.
3. **Settle, the GitHub way.** Maintainers label an issue `accepted` or `declined`, and reactions are shown as a signal. Accepted issues are written into the store with `source = issue:<n>`, and the issue thread remains the claim's debate record.
