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
| `store/schema.sql` | Tables, integrity triggers, composition views |
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

## Contributions through GitHub Issues (planned)

1. **Propose.** Anyone opens an issue from a form: *propose a nano*, *file a claim* or *report an evaluation*.
2. **Show.** The client shows open proposals next to the store, marked as proposals. Proposed claims take part in disagreement reports.
3. **Settle, the GitHub way.** Maintainers label an issue `accepted` or `declined`, and reactions are shown as a signal. Accepted issues are written into the store with `source = issue:<n>`, and the issue thread remains the claim's debate record.
