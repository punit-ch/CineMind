process.env.GEMINI_API_KEY = 'test-key';
process.env.TMDB_API_KEY = 'test-key';
process.env.AI_RETRY_DELAY_MS = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const llm = require('../services/llmClient');
const gemini = require('../services/geminiService');

const realGenerate = llm.generateJSONText;
const realChat = llm.chat;
test.afterEach(() => {
  llm.generateJSONText = realGenerate;
  llm.chat = realChat;
});

test('getRecommendations accepts a bare array', async () => {
  llm.generateJSONText = async () => '[{"title":"Heat","year":1995}]';
  const recs = await gemini.getRecommendations({ favoriteMovies: ['Ronin'] });
  assert.deepEqual(recs, [{ title: 'Heat', year: 1995 }]);
});

test('getRecommendations accepts {recommendations: [...]}', async () => {
  llm.generateJSONText = async () => '{"recommendations":[{"title":"Ronin"}]}';
  const recs = await gemini.getRecommendations({ genres: ['Thriller'] });
  assert.deepEqual(recs, [{ title: 'Ronin' }]);
});

test('user input is cleaned before it reaches the prompt', async () => {
  let prompt = '';
  llm.generateJSONText = async (p) => {
    prompt = p;
    return '[]';
  };
  await gemini.getRecommendations({ favoriteMovies: ['Heat`<script>'] });
  assert.ok(prompt.includes('Heat script'));
  assert.ok(!prompt.includes('<script>'));
});

test('retries once when the model returns invalid JSON', async () => {
  let calls = 0;
  llm.generateJSONText = async () => {
    calls += 1;
    return calls === 1 ? 'not json at all' : '[{"title":"X"}]';
  };
  const recs = await gemini.getMoodRecommendations('cozy');
  assert.equal(calls, 2);
  assert.deepEqual(recs, [{ title: 'X' }]);
});

test('retries once on a 429 and then succeeds', async () => {
  let calls = 0;
  llm.generateJSONText = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('quota'), { status: 429 });
    return '[]';
  };
  assert.deepEqual(await gemini.getMoodRecommendations('calm'), []);
  assert.equal(calls, 2);
});

test('gives up after two bad responses', async () => {
  let calls = 0;
  llm.generateJSONText = async () => {
    calls += 1;
    return 'still not json';
  };
  await assert.rejects(gemini.getMoodRecommendations('tense'), SyntaxError);
  assert.equal(calls, 2);
});

test('does not retry non-retryable errors', async () => {
  let calls = 0;
  llm.generateJSONText = async () => {
    calls += 1;
    throw Object.assign(new Error('bad request'), { status: 400 });
  };
  await assert.rejects(gemini.getMoodRecommendations('sad'), { status: 400 });
  assert.equal(calls, 1);
});

test('analyzeTasteProfile returns a default profile without calling the model when there is no history', async () => {
  let calls = 0;
  llm.generateJSONText = async () => {
    calls += 1;
    return '{}';
  };
  const profile = await gemini.analyzeTasteProfile([]);
  assert.equal(calls, 0);
  assert.deepEqual(profile.topGenres, []);
  assert.equal(profile.favoriteEra, 'Unknown');
});

test('compareMovies cleans both titles', async () => {
  let prompt = '';
  llm.generateJSONText = async (p) => {
    prompt = p;
    return '{"verdict":"ok"}';
  };
  const result = await gemini.compareMovies('Heat{}', 'Ronin<b>');
  assert.deepEqual(result, { verdict: 'ok' });
  assert.ok(prompt.includes('<movieA>Heat</movieA>'));
  assert.ok(prompt.includes('<movieB>Ronin b</movieB>'));
});

test('chat delegates to the LLM client with the CineMind system instruction', async () => {
  let received;
  llm.chat = async (messages, systemInstruction) => {
    received = { messages, systemInstruction };
    return 'hi there';
  };
  const reply = await gemini.chat([{ role: 'user', content: 'hello' }]);
  assert.equal(reply, 'hi there');
  assert.equal(received.messages.length, 1);
  assert.match(received.systemInstruction, /CineMind AI/);
});
