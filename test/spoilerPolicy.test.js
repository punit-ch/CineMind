process.env.GEMINI_API_KEY = 'test-key';
process.env.TMDB_API_KEY = 'test-key';
process.env.AI_RETRY_DELAY_MS = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const llm = require('../services/llmClient');
const gemini = require('../services/geminiService');
const { SPOILER_RULE } = require('../services/spoilerPolicy');

const realGenerate = llm.generateJSONText;
const realChat = llm.chat;
test.afterEach(() => {
  llm.generateJSONText = realGenerate;
  llm.chat = realChat;
});

const capture = (response) => {
  const prompts = [];
  llm.generateJSONText = async (p) => {
    prompts.push(p);
    return response;
  };
  return prompts;
};

test('the spoiler rule is strict and names the main risks', () => {
  assert.match(SPOILER_RULE, /no exceptions/i);
  assert.match(SPOILER_RULE, /twists/i);
  assert.match(SPOILER_RULE, /endings/i);
});

test('every JSON prompt carries the spoiler rule', async () => {
  // One response shape that every method accepts (array-or-wrapped for recommendations and picks)
  const prompts = capture('{"recommendations":[],"picks":[]}');
  await gemini.getRecommendations({ genres: ['Drama'] });
  await gemini.getMoodRecommendations('calm');
  await gemini.analyzeMovie('Heat');
  await gemini.planMovieNight({ people: 2, mood: 'fun' });
  await gemini.analyzeTasteProfile(['Heat']);
  await gemini.compareMovies('Heat', 'Ronin');
  await gemini.pickFromCandidates({ candidates: [{ id: 1, title: 'A', releaseYear: '2000', genres: [], rating: 7 }], mood: 'x' });

  assert.equal(prompts.length, 7);
  for (const p of prompts) assert.ok(p.includes(SPOILER_RULE), 'a prompt is missing the spoiler rule');
});

test('the critic prompt no longer asks for scenes or plot-based details', async () => {
  const prompts = capture('{}');
  await gemini.analyzeMovie('Heat');
  const p = prompts[0];
  assert.match(p, /never describe specific scenes or plot events/i);
  assert.doesNotMatch(p, /reference real scenes/i);
  assert.match(p, /"bestMoment": "A spoiler-free reason to watch/);
  assert.match(p, /"hiddenDetails": "A spoiler-free craft detail/);
});

test('the critic keeps the same JSON keys the frontend expects', async () => {
  const prompts = capture('{}');
  await gemini.analyzeMovie('Heat');
  for (const key of ['overallVerdict', 'rating', 'themes', 'strengths', 'weaknesses', 'cinematography', 'storytelling', 'performances', 'whoShouldWatch', 'whoShouldSkip', 'similarMovies', 'bestMoment', 'hiddenDetails']) {
    assert.ok(prompts[0].includes(`"${key}"`), `missing key ${key}`);
  }
});

test('the chat assistant is told to refuse spoilers', async () => {
  let instruction = '';
  llm.chat = async (messages, systemInstruction) => {
    instruction = systemInstruction;
    return 'ok';
  };
  await gemini.chat([{ role: 'user', content: 'who dies at the end?' }]);
  assert.ok(instruction.includes(SPOILER_RULE));
  assert.match(instruction, /politely decline/i);
});

test('pickFromCandidates lists refs, cleans titles and returns the picks array', async () => {
  const prompts = capture('{"picks":[{"ref":"movie:1","reason":"r"}]}');
  const picks = await gemini.pickFromCandidates({
    candidates: [
      { id: 1, title: 'Heat`{x}', releaseYear: '1995', genres: ['Crime'], rating: 8, mediaType: 'movie' },
      { id: 9, title: 'The Wire', releaseYear: '2002', genres: ['Drama'], rating: 8.5, mediaType: 'tv' },
    ],
    mood: 'tense',
    minutes: 120,
    count: 2,
  });
  assert.deepEqual(picks, [{ ref: 'movie:1', reason: 'r' }]);
  const p = prompts[0];
  assert.ok(p.includes('movie:1 | Heat x (1995)'));
  assert.ok(p.includes('tv:9 | The Wire (2002)'));
  assert.ok(p.includes('120 minutes'));
  assert.match(p, /Pick exactly 2/);
});
