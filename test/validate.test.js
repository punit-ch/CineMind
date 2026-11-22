const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanText, cleanList, toInt, HttpError } = require('../utils/validate');

test('cleanText strips control chars, backticks, braces and angle brackets', () => {
  assert.equal(cleanText('a`b{c}<d>\u0007e'), 'a b c d e');
});

test('cleanText collapses whitespace and trims', () => {
  assert.equal(cleanText('  hello   \n world '), 'hello world');
});

test('cleanText caps length and handles null/undefined', () => {
  assert.equal(cleanText('x'.repeat(500), 10).length, 10);
  assert.equal(cleanText(null), '');
  assert.equal(cleanText(undefined), '');
});

test('cleanList drops empties and duplicates', () => {
  assert.deepEqual(cleanList(['Heat', 'Heat', '', '   ', 'Ronin']), ['Heat', 'Ronin']);
});

test('cleanList respects maxItems and maxLen', () => {
  assert.deepEqual(cleanList(['a', 'b', 'c'], { maxItems: 2 }), ['a', 'b']);
  assert.deepEqual(cleanList(['abcdef'], { maxLen: 3 }), ['abc']);
});

test('cleanList returns [] for non-arrays', () => {
  assert.deepEqual(cleanList('not an array'), []);
  assert.deepEqual(cleanList(undefined), []);
});

test('toInt parses, falls back and clamps', () => {
  assert.equal(toInt('5', 1), 5);
  assert.equal(toInt('abc', 7), 7);
  assert.equal(toInt('9999', 1, { max: 50 }), 50);
  assert.equal(toInt('-3', 1, { min: 0 }), 0);
});

test('HttpError carries status and is safe to expose', () => {
  const err = new HttpError(400, 'bad input');
  assert.ok(err instanceof Error);
  assert.equal(err.status, 400);
  assert.equal(err.message, 'bad input');
  assert.equal(err.expose, true);
});
