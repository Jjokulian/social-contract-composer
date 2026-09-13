# Nano store — design

*Status: agreed direction, revision 2. It still needs a go-ahead before the build starts. Once built, it replaces `micro-social-contracts/README.md` as the format spec.*

## The idea

Agreements are built from **nanos**: small shards, each stored once and reused by any number of micro-contracts and Social Contracts. At the top of every contract sit **intents** that people can grasp directly ("to protect mothers"). Below them sit **clauses**, the actual agreements. What joins them are **claims**: "in this context, this clause supports (or hinders) that intent, for this reason, and here is how you would check."

A claim is never true or false on its own. It is true or false **in a context**: the other clauses around it, the parameter values adopters chose, and assumptions about the society that adopts it. The context is written into the claim, which lets the composer work out *where two claims part ways* when they use the same nanos and reach different conclusions. That difference becomes the agenda for investigation or debate. At minimum it gives a visible view of the disagreement.

The composer never solves for anything. It takes a given selection and computes what it claims to satisfy, where claims disagree and why, what is uncovered, and what conflicts. Every check is a single pass or a pairwise comparison over the graph. No satisfiability search is needed anywhere.

## Levels

```
Social Contract          a composition of micro-contracts (nested or added side by side)
└─ micro-social-contract a manifest: an intent tree + the nanos that serve it
   └─ nano               one intent, clause, definition, parameter, assumption, claim, …
```

## Nano kinds

| Kind | What it is | Example |
|---|---|---|
| `intent` | A purpose people can grasp directly | *To make pregnancy a delight* |
| `clause` | An agreement: who commits to what (shall / shall not / may) | *Society provides prenatal care free at the point of use* |
| `definition` | A term and its meaning | *Abortion: ending a pregnancy by extraction once the child can live on its own, or removal after it has died* |
| `parameter` | A term that adopters set, with a domain | *Extraction threshold: 22–37 completed weeks* |
| `measure` | Something observable in a society | *Approved adoptive families per relinquished newborn* |
| `assumption` | A belief about the society, stated as a condition on a measure where possible | *Approved adoptive families per relinquished newborn ≥ 1* |
| `claim` | A conclusion about how one nano relates to another, **plus the context it depends on** | see below |
| `evaluation` | An observed value of a measure, in a named society, with a source | *Society X, 2031: 0.8 families per newborn* |
| `resource` | A service or facility with a cost model (feeds the cost explorer) | *NICU bed: capital, daily cost* |

## Claims carry their context

```yaml
id: claim:guardianship-transfer--protect-babies--a
rev: 1
from: clause:guardianship-transfer@1
relation: supports              # supports | hinders | conflicts
to: intent:protect-babies@1
strength: contributes           # contributes | sufficient
context:
  given:                        # nanos that must be in the composition for the claim to apply
    - clause:guardianship-transfer@1
    - clause:placement-within-window@1
  when:                         # conditions on parameter values chosen by adopters
    - parameter:placement-window-months@1 <= 12
  assuming:                     # beliefs about the society; checkable against evaluations
    - assumption:adoptive-families-exceed-relinquished-newborns@1
rationale: Newborns are placed with permanent families quickly, so none grow up in institutional care.
filed-by: pro-pregnancy authors
```

A claim **applies** to a composition in a given society when three things hold:
- all of its `given` nanos are in the composition,
- all of its `when` conditions hold at the chosen parameter values,
- and none of its `assuming` conditions are contradicted by that society's evaluations. If a society has no evaluation yet, the claim applies and is marked *unverified*.

### Computing a disagreement

Two claims **disagree** when they share `from` and `to` but differ in `relation` or `strength`. For each disagreeing pair, the composer computes a **context diff** and classifies it:

| Class | Meaning | What settles it |
|---|---|---|
| **Direct** | Same context, opposite conclusions | Debate about the reasoning and evidence itself |
| **Divergent context** | One claim considers nanos the other ignores | Whether those extra nanos belong in the picture |
| **Crux on assumption** | The two claims assume disjoint values of the same measure | An evaluation of that measure, *per society* |
| **Conditional** | The two claims hold at disjoint parameter values | Nothing to settle: both hold, and the adopters' parameter choice decides which applies |

Conditions are simple comparisons of one measure or parameter against a constant. So "are these disjoint?" is interval arithmetic, not a solver.

**Worked example.** Someone files an issue with a second claim:

```yaml
id: claim:guardianship-transfer--protect-babies--b
from: clause:guardianship-transfer@1
relation: hinders
to: intent:protect-babies@1
context:
  given:    [clause:guardianship-transfer@1]
  assuming: [assumption:relinquished-newborns-exceed-adoptive-families@1]
rationale: Newborns who aren't placed grow up in long-term state care.
```

The composer's report:

```
DISAGREEMENT  guardianship-transfer → protect-babies   (supports  vs  hinders)
  shared context   clause:guardianship-transfer@1
  only in A        clause:placement-within-window@1
                   when placement-window-months <= 12
                   assuming adoptive-families-per-relinquished-newborn >= 1
  only in B        assuming adoptive-families-per-relinquished-newborn <  1
  class            CRUX ON ASSUMPTION: measure adoptive-families-per-relinquished-newborn
  settled by       an evaluation of that measure in the adopting society
```

So both claims can be right in different societies, and the composer names the single observation that decides between them.

## The store: one database, built from an append-only log

Revisions are immutable, so the canonical record only ever grows. It lives as an append-only log in git, and every build compiles it into one SQLite database.

```
store/
  log/<kind>.jsonl              # one line per nano revision, append-only (git diffs are pure additions)
  schema.sql                    # tables + the check views
micro-social-contracts/<id>/manifest.json   # the intent tree: nesting is contract-specific, so it lives here
social-contracts/<id>/manifest.json
tools/build.mjs                 # log + manifests + issue snapshot → site/store.sqlite + check report
site/                           # the GitHub Pages app; loads store.sqlite with sql.js (SQLite in WASM)
.github/ISSUE_TEMPLATE/         # forms for proposing a nano, a claim or an evaluation
.github/workflows/              # rebuild + deploy on push and on issue changes
```

Why this shape:
- **Computable.** Nanos, claims, contexts and manifests are relational tables. Gaps, orphans, conflicts, clashes and disagreements are **SQL views**, and the same database file answers the same queries in CI, in node and in the browser.
- **Efficient.** The site ships one indexed file, and sql.js queries it in memory. If the store grows large, sql.js-httpvfs reads just the pages a query needs with HTTP range requests, which works on GitHub Pages.
- **Reviewable.** A change to the store is appended lines in a PR, never an opaque binary diff. The `.sqlite` file is a build output and is never committed.

Core tables, sketched:

```sql
nano(id, rev, kind, body_json, filed_by, source, status, PRIMARY KEY (id, rev))
claim(id, rev, from_ref, relation, to_ref, strength)
claim_given(claim_ref, nano_ref)
claim_when(claim_ref, parameter_ref, op, value)
claim_assuming(claim_ref, assumption_ref)
assumption(id, rev, measure_ref, op, value)          -- op/value NULL for non-quantified beliefs
evaluation(id, rev, measure_ref, society, value, observed_on, source_url)
manifest_node(contract, contract_rev, parent_ref, child_ref, combine)   -- 'all' | 'any'
manifest_member(contract, contract_rev, nano_ref)
issue(number, kind, title, state, labels_json, reactions_up, reactions_down, body_json)
-- views: v_applicable_claims, v_gaps, v_orphans, v_conflicts, v_definition_clashes,
--        v_disagreements (with context diff and class), v_intent_rollup
```

## Contributions: GitHub Issues

The Pages site shows two layers: the **accepted** store, plus everyone's **proposals**.

1. **Propose.** Anyone opens an issue from a form: *Propose a nano*, *File a claim* or *Report an evaluation*. The forms produce structured bodies that the build parses into the `issue` table.
2. **Show.** Proposals appear on the site right away, marked as proposals, next to accepted content. Proposed claims take part in disagreement reports too, so a new counter-claim is visible the moment it's filed. The build snapshots issues into the database, and the site can also fetch live issue state from the GitHub API for freshness.
3. **Settle, the GitHub way.** Maintainers label an issue `accepted` or `declined`, and 👍/👎 reactions are recorded as a signal. A workflow turns an `accepted` issue into a line in `store/log/`, commits it, and closes the issue with a link to the new nano. Discussion stays on the issue, which is the claim's permanent debate record.

## What the composer checks

For a selected composition, with its chosen parameter values and optionally a society:

1. **Resolve.** Every pinned `id@rev` exists.
2. **Conflicts.** Any applicable `conflicts` claim whose two ends are both in the composition.
3. **Definition clashes.** Two definitions of the same term in one composition.
4. **Gaps.** Intents that no applicable claim supports, rolled up through *all of* / *any of*.
5. **Orphans.** Clauses that serve no intent in the composition.
6. **Tensions.** A clause that supports one intent and hinders another.
7. **Disagreements.** Pairs of claims with the same `from` and `to` and different conclusions, with their context diff and class (above).
8. **Rollup.** Each intent is labeled *claimed*, *thin*, *gap*, *in tension* or *disputed*, together with its evidence status (*unverified*, *supported by evaluation*, *contradicted by evaluation*).

**Nesting** places micro-contract root intents under a Social Contract's own intents. **Adding** unions nanos: a nano with the same `id@rev` merges, and different definitions of one term surface as clashes.

## Migration of the current draft

`micro-social-contracts/pro-pregnancy/contract.md` is committed first, so it lives in git history. It is then split into nanos and a manifest, and deleted. The placeholder term "pregnant person" gives way to the contract's own words ("mothers", "babies") unless the adopters choose otherwise.
