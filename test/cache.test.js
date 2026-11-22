process.env.GEMINI_API_KEY = 'test-key';
process.env.TMDB_API_KEY = 'test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../utils/cache');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('set and get return the stored value', () => {
  cache.set('k1', { a: 1 });
  assert.deepEqual(cache.get('k1'), { a: 1 });
  assert.equal(cache.has('k1'), true);
});

test('missing keys return null', () => {
  assert.equal(cache.get('does-not-exist'), null);
  assert.equal(cache.has('does-not-exist'), false);
});

test('entries expire after their TTL', async () => {
  cache.set('short', 'value', 15);
  assert.equal(cache.get('short'), 'value');
  await sleep(40);
  assert.equal(cache.get('short'), null);
});

test('delete removes an entry', () => {
  cache.set('gone', 1);
  cache.delete('gone');
  assert.equal(cache.get('gone'), null);
});
