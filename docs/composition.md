# How a composition is resolved

A composition is resolved the way a linker resolves symbols: by declared rules, never by the order in which its includes are listed. `public/compose.mjs` implements these rules, and the tests check the invariant at the end.

## 1. Precedence

Contracts are ranked:

1. The composition itself comes first.
2. After it come the contracts it reaches, by nesting depth, the outermost first.
3. At one depth, the later-composed contract (the later revision in the store) comes first.

Wherever two contracts decide the same thing, the one with precedence decides. There is no other tie-break anywhere.

## 2. Reach

Contracts are reached depth by depth from the composition. At each depth, in precedence order, a contract is reached unless a contract with precedence has abrogated it. A reached contract's abrogations apply to contracts not yet reached. So:

- a contract can only be abrogated by one with precedence over it;
- an abrogated contract's own includes and operators have no effect, unless it is reached some other way first;
- a contract reached through the base on any path counts as coming through the base.

## 3. Members

Every reached contract brings in its intents, members, parameters and the nanos that define its socioship terms. A member's origin is the contract with precedence that brings it. Lex superior (is it the base?) and lex posterior (how late was it composed?) read the origin.

## 4. Operators on provisions

Derogation, subrogation and obrogation apply from the lowest precedence to the highest. So for each provision, the contract with precedence has the last word: an included contract's operator can never undo the composition's own. An obrogation's replacement takes the place, and the origin, of what it replaces. A subrogated provision's origin is the contract it is added into.

## 5. Settings

The contract with precedence decides each of these:

- parameter values;
- consequences of breach;
- who detects breaches;
- the nanos defining each socioship term.

## 6. Conflicts left

The composition's own maxims resolve the conflicts that no operator settles, in its order: lex superior, lex specialis and lex posterior. The losing side is set aside and its claims stop counting. With no maxim deciding, the conflict stays open. Of each claim, only one revision counts: the one the composition endorses, or else the latest.

## The invariant

Permuting the includes of any composition never changes its snapshot, apart from the list of includes itself (`test/composer.test.mjs`).
