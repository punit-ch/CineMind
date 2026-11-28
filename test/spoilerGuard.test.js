process.env.GEMINI_API_KEY = 'test-key';
process.env.TMDB_API_KEY = 'test-key';
process.env.AI_RETRY_DELAY_MS = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../services/spoilerGuard');
const llm = require('../services/llmClient');
const gemini = require('../services/geminiService');

const RISKY = [
  'The hero dies in the third act.',
  'It turns out that the butler did it.',
  'The twist ending will shock you.',
  'By the end, everything changes.',
  'The villain is his own brother.',
  'She does not survive the night.',
  'A big reveal changes everything we know.',
  'He kills himself.',
  "It's all a dream in the final scene.",
  'The real killer is never caught.',
];

const BENIGN = [
  'A gripping thriller about a detective hunting a serial killer.',
  'Beautifully shot, with a haunting score.',
  'Warm, funny and easy to watch on a lazy evening.',
  'A heist crew plans one last job.',
  'Perfect for a rainy day with friends.',
  'Fans of slow-burn character drama will feel at home.',
  'The performances anchor a story about family and loss.',
  'Expect sharp dialogue and a dry sense of humour.',
];

test('sentences that usually signal spoilers are flagged', () => {
  for (const s of RISKY) assert.equal(guard.isRisky(s), true, `should flag: ${s}`);
});

test('ordinary descriptions are not flagged', () => {
  for (const s of BENIGN) assert.equal(guard.isRisky(s), false, `should not flag: ${s}`);
});

test('hasRisk scans nested values but skips title-like keys', () => {
  assert.equal(guard.hasRisk({ title: 'The Man Who Killed Don Quixote', whyWatch: 'A charming adventure.' }), false);
  assert.equal(guard.hasRisk({ similarMovies: ['The Day the Earth Dies'], movie1: 'Who Dies Next?' }), false);
  assert.equal(guard.hasRisk([{ explanation: 'Fun. The hero dies at the end.' }]), true);
  assert.equal(guard.hasRisk({ a: { b: ['fine', { c: 'The twist ending is great.' }] } }), true);
  assert.equal(guard.hasRisk(null), false);
  assert.equal(guard.hasRisk(42), false);
});

test('scrub removes only the risky sentences and counts them', () => {
  const input = { title: 'Heat', explanation: 'A taut crime saga. The hero dies at the end. Superb cast.', themes: ['Obsession'], n: 5 };
  const { value, removed } = guard.scrub(input);
  assert.equal(removed, 1);
  assert.equal(value.explanation, 'A taut crime saga. Superb cast.');
  assert.equal(value.title, 'Heat');
  assert.deepEqual(value.themes, ['Obsession']);
  assert.equal(value.n, 5);
});

test('scrub does not mutate its input and leaves clean data alone', () => {
  const input = { explanation: 'Fun. The villain is his brother.' };
  const copy = JSON.stringify(input);
  guard.scrub(input);
  assert.equal(JSON.stringify(input), copy);
  assert.deepEqual(guard.scrub({ a: 'All good.' }), { value: { a: 'All good.' }, removed: 0 });
});

test('scrub can empty a field that has only risky sentences', () => {
  assert.equal(guard.scrub({ reason: 'The twist ending is brilliant.' }).value.reason, '');
});

// ─── flow inside the Gemini service ──────────────────────────────────────────
const realGenerate = llm.generateJSONText;
const realChat = llm.chat;
const realWarn = console.warn;
test.beforeEach(() => { console.warn = () => {}; });
test.afterEach(() => { llm.generateJSONText = realGenerate; llm.chat = realChat; console.warn = realWarn; });

const sequence = (...answers) => {
  const prompts = [];
  llm.generateJSONText = async (prompt) => {
    prompts.push(prompt);
    const next = answers[Math.min(prompts.length - 1, answers.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  return prompts;
};
const rec = (explanation) => JSON.stringify([{ title: 'Heat', explanation }]);

test('a clean answer costs a single call', async () => {
  const prompts = sequence(rec('A taut crime saga.'));
  const out = await gemini.getMoodRecommendations('tense');
  assert.equal(prompts.length, 1);
  assert.equal(out[0].explanation, 'A taut crime saga.');
});

test('a risky answer triggers one stricter retry, and a clean retry is used as is', async () => {
  const prompts = sequence(rec('Great. The hero dies at the end.'), rec('A taut crime saga.'));
  const out = await gemini.getMoodRecommendations('tense');
  assert.equal(prompts.length, 2);
  assert.ok(prompts[1].includes('may reveal plot details'));
  assert.equal(out[0].explanation, 'A taut crime saga.');
});

test('if the retry is still risky, the offending sentences are removed', async () => {
  const prompts = sequence(rec('Great. The hero dies at the end.'), rec('Superb. The twist ending is wild.'));
  const out = await gemini.getMoodRecommendations('tense');
  assert.equal(prompts.length, 2);
  assert.equal(out[0].explanation, 'Superb.');
});

test('if the retry fails, the first answer is scrubbed instead of failing the request', async () => {
  const prompts = sequence(rec('Great. The villain is his brother.'), Object.assign(new Error('bad request'), { status: 400 }));
  const out = await gemini.getMoodRecommendations('tense');
  assert.equal(prompts.length, 2);
  assert.equal(out[0].explanation, 'Great.');
});

test('titles that contain trigger words do not cause retries', async () => {
  const prompts = sequence(JSON.stringify([{ title: 'The Man Who Killed Don Quixote', explanation: 'A fantastical adventure.' }]));
  const out = await gemini.getMoodRecommendations('fun');
  assert.equal(prompts.length, 1);
  assert.equal(out[0].title, 'The Man Who Killed Don Quixote');
});

test('Tonight reasons are guarded too', async () => {
  sequence(JSON.stringify({ picks: [{ ref: 'movie:1', reason: 'Cosy. By the end you will cry.', tonightFit: 'Easy' }] }), JSON.stringify({ picks: [{ ref: 'movie:1', reason: 'A cosy pick.', tonightFit: 'Easy' }] }));
  const picks = await gemini.pickFromCandidates({ candidates: [{ id: 1, title: 'A', releaseYear: '2000', genres: [], rating: 7 }], mood: 'cosy' });
  assert.equal(picks[0].reason, 'A cosy pick.');
});

test('chat: a risky reply gets one stricter retry', async () => {
  const calls = [];
  llm.chat = async (messages, instruction) => {
    calls.push(instruction);
    return calls.length === 1 ? 'You will love it. The hero dies at the end.' : 'You will love its warmth.';
  };
  const reply = await gemini.chat([{ role: 'user', content: 'Tell me about Heat' }]);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes('may reveal plot details'));
  assert.equal(reply, 'You will love its warmth.');
});

test('chat: remaining risky sentences are removed, and an emptied reply becomes a friendly fallback', async () => {
  llm.chat = async () => 'Nice pick. The twist ending is wild.';
  assert.equal(await gemini.chat([{ role: 'user', content: 'hi' }]), 'Nice pick.');
  llm.chat = async () => 'The twist ending is wild.';
  assert.equal(await gemini.chat([{ role: 'user', content: 'hi' }]), guard.FALLBACK_REPLY);
});

test('chat: a clean reply costs one call and a refusal that mentions "spoilers" is allowed', async () => {
  let calls = 0;
  llm.chat = async () => { calls += 1; return "I can't share spoilers, but I can say it's a warm drama."; };
  const reply = await gemini.chat([{ role: 'user', content: 'who dies?' }]);
  assert.equal(calls, 1);
  assert.ok(reply.includes("can't share spoilers"));
});
