import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instant, dateOf } from '../public/space.mjs';
import { extent, samples, eventsOf, ticksOf, yearLabel } from '../public/timeline.mjs';

const demesne = (id, from = null, until = null, after = null) => ({ id, rev: 1, ref: `${id}@1`, name: id, space: 'earth', from, until, after });

test('a timeline spans what the demesnes record, counts what was in force, and marks what happened', () => {
  const list = [demesne('old', '1800', '1850'), demesne('new', '1850', null, 'old@1'), demesne('always')];
  const span = extent(list);
  assert.ok(span.start < instant('1800').start && span.end > instant('1850').end, 'with room before the first and after the last');
  assert.equal(extent([demesne('always')]), null, 'nothing to span where no period is recorded');

  const levels = new Map([['old@1', 1], ['new@1', 2], ['always@1', 1]]);
  assert.equal(samples(list, span, levels, 5).length, 5);
  const at = year => samples(list, { start: instant(year).start, end: instant(year).start }, levels, 1)[0];
  assert.deepEqual(at('1820').byLevel, [2], 'the one in force and the one with no period, both at level 1');
  assert.equal(at('1820').total, 2);
  assert.deepEqual(at('1870').byLevel, [1, 1], 'each counted at the level it lies at');
  assert.deepEqual(at('1750').byLevel, [1], 'before any period, only the demesne that records none');

  assert.deepEqual(eventsOf(list).map(e => [e.kind, e.ref]),
    [['began', 'old@1'], ['after', 'new@1'], ['began', 'new@1'], ['ended', 'old@1']],
    'in time order; the year a demesne ends comes after the day another begins in it');

  const ticks = ticksOf({ start: instant('1800').start, end: instant('1900').end }, 6);
  assert.ok(ticks.length <= 6 && ticks.every(t => t.year % 25 === 0), 'round years, at most as many as asked for');
  assert.deepEqual(ticksOf({ start: instant('-0340').start, end: instant('-0300').end }, 5).map(t => t.year), [-340, -330, -320, -310, -300]);
  assert.equal(yearLabel(-323), '323 BC');
  assert.equal(yearLabel(1789), '1789');
});

test('an instant reads back as the day it falls on', () => {
  for (const text of ['1789-04-30', '-0323-06-11', '0001-01-01']) assert.equal(dateOf(instant(text).start), text);
  assert.equal(dateOf(instant('1806').start), '1806-01-01', 'a year begins on its first day');
  assert.equal(dateOf(instant('1806').end), '1806-12-31', 'and ends on its last');
});
