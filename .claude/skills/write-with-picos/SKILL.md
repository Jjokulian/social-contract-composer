---
name: write-with-picos
description: Write or revise contract text in the Social Contract Composer store using picos, the strictly defined words. Use when adding or changing intents, clauses, claims, definitions or influences; when a word is used in a strict sense; or when asked to define a word, add a pico, or check what a word means in a contract.
---

# Writing with picos

A **pico** is a strictly defined word. It is stored as a `definition` nano with a `term`, a `meaning` and `forms`, the words that usually refer to it.

**A nano records its picos when it is written.** Each nano revision stores which of its phrases refer to which pico revisions (`nano_pico`). The record is immutable, like its text. Adding or revising a pico never changes what an existing nano means. **To make a nano use another pico, write a new revision of the nano.** Forms only *suggest* references while you write.

## Before you write

1. `node tools/picos.mjs list <contract>`: the picos the contract defines, with their forms and meanings.
2. `node tools/picos.mjs suggest <contract> "<your text>"`: how the text would link, and the exact `picos: [...]` to record. Review every suggestion against the sense you mean, and drop any that don't fit.

## Choosing, word by word

- **The word means what an existing pico defines.** Record the reference: `addNano(db, { …, picos: [{ phrase: 'fatal risk', pico: 'fatal-risk.pro-pregnancy@3' }] })`. The phrase must occur in the nano's text.
- **The word is used in a strict sense no pico covers.** Create a pico with the authors' definition in their words. Give it phrase-level forms, and add it to the contract with `reviseContract(db, '<contract>', { add: [ref] })`. Then record references to it in the nanos you write.
- **The same word in another sense.** Create a separate pico with forms that don't overlap. In `pro-pregnancy`, *mother thriving* ("mother thrives") and *baby thriving* ("survive and thrive", "its thriving") are two picos.
- **A better or revised pico for a word already in use.** Existing nanos keep their old references on purpose. The composer shows them as *different revisions in use* or *competing senses*. Rewrite each nano that should adopt the new pico as a new revision, and swap it into the contract with `reviseContract(…, { replace: { old: new } })`.

## After you write

3. `node tools/picos.mjs check <contract>`. It exits with 1 on any of these; resolve them or leave them deliberately:
   - different revisions of a pico in use
   - competing senses of one term
   - forms shared by two picos

   It also lists suggestions that weren't recorded and look-alike words, for you to review.
4. `npm test` and `npm run build:static`.
