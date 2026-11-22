process.env.GEMINI_API_KEY = 'test-key';
process.env.TMDB_API_KEY = 'test-key';
process.env.GEMINI_MODEL = 'primary-model';
process.env.GEMINI_FALLBACK_MODELS = 'second-model,third-model';

const test = require('node:test');
const assert = require('node:assert/strict');
const llm = require('../services/llmClient');

const notFound = (model) => Object.assign(new Error(`models/${model} is not found`), { status: 404 });
const rateLimited = () => Object.assign(new Error('quota exceeded'), { status: 429 });

test.beforeEach(() => llm._resetForTests());

test('modelCandidates lists primary then fallbacks without duplicates', () => {
  assert.deepEqual(llm.modelCandidates(), ['primary-model', 'second-model', 'third-model']);
});

test('isModelUnavailable recognises 404 and "not found" messages only', () => {
  assert.equal(llm.isModelUnavailable({ status: 404 }), true);
  assert.equal(llm.isModelUnavailable(new Error('models/x is not found for API version')), true);
  assert.equal(llm.isModelUnavailable({ status: 429, message: 'quota' }), false);
  assert.equal(llm.isModelUnavailable(new Error('boom')), false);
});

test('withModelFallback moves to the next model on a model-unavailable error', async () => {
  const tried = [];
  const result = await llm.withModelFallback(async (model) => {
    tried.push(model);
    if (model === 'primary-model') throw notFound(model);
    return `ok:${model}`;
  });
  assert.equal(result, 'ok:second-model');
  assert.deepEqual(tried, ['primary-model', 'second-model']);
});

test('withModelFallback does not fall back on other errors', async () => {
  const tried = [];
  await assert.rejects(
    llm.withModelFallback(async (model) => {
      tried.push(model);
      throw rateLimited();
    }),
    { status: 429 }
  );
  assert.deepEqual(tried, ['primary-model']);
});

test('withModelFallback throws the last error when every model is unavailable', async () => {
  await assert.rejects(
    llm.withModelFallback(async (model) => {
      throw notFound(model);
    }),
    /third-model/
  );
});

test('a model known to be unavailable is skipped on the next call', async () => {
  await llm.withModelFallback(async (model) => {
    if (model === 'primary-model') throw notFound(model);
    return 'ok';
  });
  const tried = [];
  await llm.withModelFallback(async (model) => {
    tried.push(model);
    return 'ok';
  });
  assert.deepEqual(tried, ['second-model']);
});

test('generateJSONText requests JSON mode and returns the text', async () => {
  const calls = [];
  llm._setClientForTests({
    models: {
      generateContent: async (args) => {
        calls.push(args);
        return { text: '{"ok":true}' };
      },
    },
  });
  const text = await llm.generateJSONText('hello');
  assert.equal(text, '{"ok":true}');
  assert.equal(calls[0].model, 'primary-model');
  assert.equal(calls[0].contents, 'hello');
  assert.equal(calls[0].config.responseMimeType, 'application/json');
});

test('generateJSONText falls back when the primary model is gone', async () => {
  const models = [];
  llm._setClientForTests({
    models: {
      generateContent: async ({ model }) => {
        models.push(model);
        if (model === 'primary-model') throw notFound(model);
        return { text: '[]' };
      },
    },
  });
  assert.equal(await llm.generateJSONText('x'), '[]');
  assert.deepEqual(models, ['primary-model', 'second-model']);
});

test('buildChatTurns maps roles, drops leading model turns and splits off the last message', () => {
  const { history, last } = llm.buildChatTurns([
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'yo' },
    { role: 'user', content: 'recommend `something`' },
  ]);
  assert.deepEqual(history, [
    { role: 'user', parts: [{ text: 'hi' }] },
    { role: 'model', parts: [{ text: 'yo' }] },
  ]);
  assert.equal(last, 'recommend something');
});

test('buildChatTurns handles a single user message', () => {
  const { history, last } = llm.buildChatTurns([{ role: 'user', content: 'hey' }]);
  assert.deepEqual(history, []);
  assert.equal(last, 'hey');
});

test('chat sends the last message with history and the system instruction', async () => {
  let created;
  let sent;
  llm._setClientForTests({
    chats: {
      create: (args) => {
        created = args;
        return {
          sendMessage: async (msg) => {
            sent = msg;
            return { text: 'a reply' };
          },
        };
      },
    },
  });
  const reply = await llm.chat(
    [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'what should I watch?' },
    ],
    'be helpful'
  );
  assert.equal(reply, 'a reply');
  assert.equal(created.model, 'primary-model');
  assert.equal(created.config.systemInstruction, 'be helpful');
  assert.equal(created.history.length, 2);
  assert.deepEqual(sent, { message: 'what should I watch?' });
});
