const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJSON, asArray } = require('../utils/aiJson');

test('parseJSON reads plain JSON', () => {
  assert.deepEqual(parseJSON('{"a":1}'), { a: 1 });
});

test('parseJSON strips markdown fences', () => {
  assert.deepEqual(parseJSON('```json\n[{"title":"Heat"}]\n```'), [{ title: 'Heat' }]);
});

test('parseJSON finds JSON surrounded by prose', () => {
  assert.deepEqual(parseJSON('Sure! Here you go: {"a":1} hope that helps'), { a: 1 });
});

test('parseJSON throws SyntaxError when there is no JSON', () => {
  assert.throws(() => parseJSON('no json here'), SyntaxError);
});

test('asArray accepts arrays and wrapped arrays', () => {
  assert.deepEqual(asArray([1, 2]), [1, 2]);
  assert.deepEqual(asArray({ recommendations: [1] }, 'recommendations'), [1]);
});

test('asArray throws on unexpected shapes', () => {
  assert.throws(() => asArray({ x: 1 }, 'recommendations'), SyntaxError);
  assert.throws(() => asArray('text'), SyntaxError);
});
