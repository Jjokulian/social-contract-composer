import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instant, dateOf } from '../public/space.mjs';
import { casesOf, inCase, caseParam, CASES } from '../public/common.mjs';
import { extent, samples, eventsOf, ticksOf, yearLabel } from '../public/timeline.mjs';

const demesne = (id, from = null, until = null, after = null) => ({ id, rev: 1, ref: `${id}@1`, name: id, space: 'earth', from, until, after });

test('a timeline spans what the demesnes record, counts what was in force, and marks what happened', () => {
  const list = [demesne('old', '1800', '1850'), demesne('new', '1850', null, 'old@1'), demesne('always'), demesne('roof', '1860', '1880')];
  const span = extent(list);
  assert.ok(span.start < instant('1800').start && span.end > instant('1880').end, 'with room before the first and after the last');
  assert.equal(extent([demesne('always')]), null, 'nothing to span where no period is recorded');

  // What contains what follows from the segments; what was in force changes with the instant.
  const containers = new Map([['old@1', new Set()], ['always@1', new Set()], ['roof@1', new Set()],
                              ['new@1', new Set(['always@1', 'roof@1'])]]);
  assert.equal(samples(list, span, containers, 5).length, 5);
  const at = year => samples(list, { start: instant(year).start, end: instant(year).start }, containers, 1)[0];
  assert.deepEqual(at('1820').byLevel, [2], 'the one in force and the one with no period, both within nothing');
  assert.equal(at('1820').total, 2);
  assert.deepEqual(at('1870').byLevel, [2, 0, 1], 'within two demesnes in force, it lies at the third level');
  assert.deepEqual(at('1890').byLevel, [1, 1], 'once one of them has ended, it rises a level');
  assert.deepEqual(at('1750').byLevel, [1], 'before any period, only the demesne that records none');

  assert.deepEqual(eventsOf(list).map(e => [e.kind, e.ref]),
    [['began', 'old@1'], ['after', 'new@1'], ['began', 'new@1'], ['ended', 'old@1'], ['began', 'roof@1'], ['ended', 'roof@1']],
    'in time order; the year a demesne ends comes after the day another begins in it');

  const ticks = ticksOf({ start: instant('1800').start, end: instant('1900').end }, 6);
  assert.ok(ticks.length <= 6 && ticks.every(t => t.year % 25 === 0), 'round years, at most as many as asked for');
  assert.deepEqual(ticksOf({ start: instant('-0340').start, end: instant('-0300').end }, 5).map(t => t.year), [-340, -330, -320, -310, -300]);
  assert.equal(yearLabel(-323), '323 BC');
  assert.equal(yearLabel(1789), '1789');
});

test('a view shows the proposed contracts, unless its address asks for the historical or the fictive', () => {
  assert.deepEqual([...casesOf('')], ['proposed'], 'what a composing view shows');
  assert.deepEqual([...casesOf('?case=historical')], ['historical']);
  assert.deepEqual([...casesOf('?case=proposed,historical')].sort(), ['historical', 'proposed']);
  assert.deepEqual([...casesOf('?case=all')].sort(), Object.keys(CASES).sort());
  assert.deepEqual([...casesOf('?case=nonsense')], ['proposed'], 'a case no one keeps falls back to the default');
  assert.deepEqual([...casesOf('', Object.keys(CASES))].sort(), Object.keys(CASES).sort(), 'the Globe and the Timeline ask for every case');

  assert.ok(inCase({ case: 'historical' }, new Set(['historical'])));
  assert.ok(!inCase({ case: 'historical' }, new Set(['proposed'])));
  assert.ok(inCase({}, new Set(['proposed'])), 'what does not say what it is, is proposed');
  assert.equal(caseParam(new Set(['proposed'])), null, 'the default is left out of the address');
  assert.equal(caseParam(new Set(['proposed', 'historical'])), 'historical,proposed');
});

test('an instant reads back as the day it falls on', () => {
  for (const text of ['1789-04-30', '-0323-06-11', '0001-01-01']) assert.equal(dateOf(instant(text).start), text);
  assert.equal(dateOf(instant('1806').start), '1806-01-01', 'a year begins on its first day');
  assert.equal(dateOf(instant('1806').end), '1806-12-31', 'and ends on its last');
});
