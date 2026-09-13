---
name: write-with-picos
description: Write or revise contract text in the Social Contract Composer store using picos, the strictly defined words. Use when adding or changing intents, clauses, claims, definitions or influences; when a word is used in a strict sense; or when asked to define a word, add a pico, or check what a word means in a contract.
---

# Writing with picos

A **pico** is a strictly defined word. It is stored as a `definition` nano with a `term`, a `meaning` and `forms`, the exact words that refer to it ("aborts", "aborting" for *abortion*). A word in any nano refers to a pico when it matches one of its forms: the longest form wins, whole words only (`public/picos.mjs`). The viewer underlines it and shows the definition on hover or focus.

## Before you write

1. `node tools/picos.mjs list <contract>`: the picos in play, their forms and meanings.
2. `node tools/picos.mjs find <contract> "<your draft text>"`: how the text would link, and look-alike words that would not.

## Choosing, word by word

- **The word means what an existing pico defines.** Use one of its forms verbatim. If you need a new wording, add it as a form in a new revision of the pico.
- **The word is used in a strict sense no pico covers.** Create a pico with the authors' definition in their words, then add it to the contract:
  `addNano(db, { id: '<term>.<contract>', kind: 'definition', term, meaning, forms, filedBy, source })`, then `reviseContract(db, '<contract>', { add: [ref] })`.
- **The same word in another sense.** Create a separate pico with forms that don't overlap. Use phrase-level forms rather than the bare word. In `pro-pregnancy`, *mother thriving* ("mother thrives", "mother's thriving") and *baby thriving* ("survive and thrive", "its thriving") are two picos, and plain "thrives" inside the mother's definition links to neither.
- **Never make a bare common word a form** if the text also uses it in another sense.

## After you write

3. `node tools/picos.mjs check <contract>`:
   - every link
   - unlinked look-alikes: check each one's sense and either add a form or leave it unlinked on purpose
   - ambiguous forms: must be `none` (the command exits with 1 otherwise)
4. `npm test` and `npm run build:static`. When links matter, look at the rendered page: the definitions section lists each pico's forms.
