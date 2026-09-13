# Micro-contract format

Each micro-contract gets its own folder: `micro-social-contracts/<id>/`. The folder holds a `contract.md` and, optionally, an `explorer/` with visual or cost models.

## `contract.md`

The front matter is the contract's **interface**: the part the composer reads to check whether a set of contracts fits together. The body is the **text**: the articles people read and agree to.

```yaml
---
id: pro-pregnancy              # stable, kebab-case, unique in the catalogue
title: Pro-Pregnancy Micro-Contract
version: 0.1.0                 # semver; a change to definitions or limits is a major bump
status: draft                  # draft | proposed | adopted-somewhere | retired
aim: One sentence.

provides:                      # capabilities other contracts can rely on
  - pregnancy-care
requires: []                   # capabilities this contract needs another contract to supply
delegates:                     # adjacent concerns this contract hands off, by capability
  - capability: child-rearing-support
    note: why it is out of scope here
conflicts:                     # contracts or capabilities that cannot co-exist with this one
  - capability: abortion-on-request
    reason: short, factual

parameters:                    # the terms adopters set when they adopt the contract
  some_parameter:
    default: 28
    range: [22, 37]
    unit: gestational weeks
    meaning: what changes when you move it

funding:
  basis: levy                  # levy | general-taxation | insurance | mixed
  note: who pays, and how the cost is shared
---
```

### Rules for composing

1. **Unique ids.** A composed Social Contract includes each `id` at most once.
2. **Every `requires` is met** by the `provides` of another contract in the set, or by an explicit statement that the society supplies it some other way.
3. **No `conflicts` pair** appears together in one set.
4. **Every `delegates` entry is claimed** by some contract in the set, or is listed as a known gap.
5. **Definitions are scoped to their contract.** If two contracts define the same term differently, the composer flags it, and the adopters decide which definition governs.

## Body

The articles are numbered, because clauses get cited: "§5.2 of pro-pregnancy". Recommended order:

1. Aim
2. Definitions
3. What society commits to
4. What citizens commit to
5. Limits
6. Funding
7. Parameters
8. Review and measures
9. Open questions for adopters (drafts only)
