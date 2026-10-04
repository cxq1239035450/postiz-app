// Offline contract tests: no real API keys, external requests or publishing.
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node' },
  project: require('node:path').join(__dirname, '../tsconfig.base.json'),
});
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { z } = require('zod');
const { zodResponseFormat } = require('openai/helpers/zod');
const {
  getAiConfig,
  isAiConfigured,
} = require('../libraries/nestjs-libraries/src/ai/ai.config');
const { aiModels } = require('../libraries/nestjs-libraries/src/ai/ai.models');

test('AI configuration and model contracts', async (t) => {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('AI_') || key.startsWith('OPENAI_'))
      delete process.env[key];
  }
  t.after(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AI_') || key.startsWith('OPENAI_'))
        delete process.env[key];
    }
    Object.assign(process.env, saved);
  });

  await t.test('legacy defaults, overrides and provider isolation', () => {
    assert.equal(
      getAiConfig('agent', { OPENAI_API_KEY: 'legacy' }).model,
      'gpt-5.2'
    );
    assert.equal(
      getAiConfig('text', { OPENAI_API_KEY: 'legacy' }).apiKey,
      'legacy'
    );
    const env = {
      AI_TEXT_PROVIDER: 'deepseek',
      AI_TEXT_API_KEY: 'text-key',
      AI_TEXT_MODEL: 'test-chat',
      OPENAI_API_KEY: 'legacy',
    };
    assert.equal(getAiConfig('agent', env).model, 'test-chat');
    assert.equal(getAiConfig('image', env).apiKey, 'legacy');
    assert.equal(
      getAiConfig('text', { ...env, AI_TEXT_API_KEY: '' }).apiKey,
      undefined
    );
    assert.equal(
      getAiConfig('chat', { ...env, AI_CHAT_MODEL: 'special' }).model,
      'special'
    );
    assert.throws(() => getAiConfig('text', { AI_TIMEOUT_MS: '-1' }));
    assert.throws(() =>
      getAiConfig('text', { AI_TEXT_BASE_URL: 'file:///tmp/model' })
    );
  });
  await t.test(
    'missing configuration fails before contacting a provider',
    async () => {
      assert.equal(isAiConfigured(), false);
      await assert.rejects(
        aiModels.complete({ messages: [] }),
        /not configured/
      );
    }
  );

  const requests = [];
  let content = '{"answer":"ok"}';
  let status = 200;
  let finish = 'stop';
  let delay = 0;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ url: req.url, key: req.headers.authorization, body });
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    res.setHeader('content-type', 'application/json');
    res.statusCode = status;
    if (status !== 200)
      return res.end(JSON.stringify({ error: { message: 'mock failure' } }));
    if (req.url.endsWith('/images/generations')) {
      return res.end(
        JSON.stringify({ created: 1, data: [{ b64_json: 'aW1hZ2U=' }] })
      );
    }
    if (body.stream) {
      res.setHeader('content-type', 'text/event-stream');
      const chunk = {
        id: 'test',
        object: 'chat.completion.chunk',
        created: 1,
        model: body.model,
      };
      res.write(
        `data: ${JSON.stringify({
          ...chunk,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'hello' },
              finish_reason: null,
            },
          ],
        })}\n\n`
      );
      res.write(
        `data: ${JSON.stringify({
          ...chunk,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`
      );
      return res.end('data: [DONE]\n\n');
    }
    const message = body.tools
      ? {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: body.tools[0].function.name,
                arguments: content,
              },
            },
          ],
        }
      : { role: 'assistant', content };
    res.end(
      JSON.stringify({
        id: 'test',
        object: 'chat.completion',
        created: 1,
        model: body.model,
        choices: [
          {
            index: 0,
            message,
            finish_reason: body.tools ? 'tool_calls' : finish,
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  Object.assign(process.env, {
    AI_TEXT_PROVIDER: 'deepseek',
    AI_TEXT_API_KEY: 'text-key',
    AI_TEXT_MODEL: 'test-chat',
    AI_TEXT_BASE_URL: base,
    AI_IMAGE_PROVIDER: 'openai',
    AI_IMAGE_API_KEY: 'image-key',
    AI_IMAGE_MODEL: 'test-image',
    AI_IMAGE_BASE_URL: base,
  });
  const input = { messages: [{ role: 'user', content: 'hello' }] };
  const schema = z.object({ answer: z.string() });
  await t.test('compatible JSON mode still validates the schema', async () => {
    const result = await aiModels.parse({
      ...input,
      response_format: zodResponseFormat(schema, 'result'),
    });
    assert.equal(result.choices[0].message.parsed.answer, 'ok');
    assert.equal(requests.at(-1).body.response_format.type, 'json_object');
    assert.equal(requests.at(-1).key, 'Bearer text-key');
    content = '{"answer":123}';
    await assert.rejects(
      aiModels.parse({
        ...input,
        response_format: zodResponseFormat(schema, 'result'),
      })
    );
    content = '{"answer":"ok"}';
    finish = 'length';
    await assert.rejects(
      aiModels.parse({
        ...input,
        response_format: zodResponseFormat(schema, 'result'),
      }),
      /complete structured/
    );
    finish = 'stop';
  });
  await t.test(
    'multiple candidates use single-candidate requests',
    async () => {
      const start = requests.length;
      const result = await aiModels.complete({ ...input, n: 3 });
      assert.equal(result.choices.length, 3);
      assert.equal(requests.length - start, 3);
      assert(requests.slice(start).every((r) => r.body.n === 1));
    }
  );
  await t.test(
    'LangGraph structured output uses tools for compatible providers',
    async () => {
      const result = await aiModels
        .structured(schema)
        .invoke('Return an answer');
      assert.equal(result.answer, 'ok');
      assert(requests.at(-1).body.tools.length > 0);
      assert.equal(requests.at(-1).body.model, 'test-chat');
    }
  );
  await t.test('AI SDK adapter uses the configured chat endpoint', async () => {
    await aiModels.languageModel().doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });
    assert.equal(requests.at(-1).url, '/v1/chat/completions');
    assert.equal(requests.at(-1).key, 'Bearer text-key');
  });
  await t.test('images use independent credentials and endpoint', async () => {
    assert.equal(
      await aiModels.imageSource('test'),
      'data:image/png;base64,aW1hZ2U='
    );
    assert.equal(requests.at(-1).key, 'Bearer image-key');
    assert.equal(requests.at(-1).body.model, 'test-image');
  });
  await t.test('AI SDK adapter preserves streaming output', async () => {
    const { stream } = await aiModels.languageModel().doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });
    const parts = [];
    for await (const part of stream) parts.push(part);
    assert(
      parts.some((part) => part.type === 'text-delta' && part.delta === 'hello')
    );
    assert(!parts.some((part) => part.type === 'error'));
  });
  await t.test('timeouts and cancellation stop model requests', async () => {
    delay = 150;
    process.env.AI_TIMEOUT_MS = '30';
    try {
      await assert.rejects(aiModels.complete(input));
      await assert.rejects(
        aiModels.languageModel().doGenerate({
          prompt: [
            { role: 'user', content: [{ type: 'text', text: 'hello' }] },
          ],
        })
      );
      await assert.rejects(
        aiModels.complete(input, { signal: AbortSignal.abort() })
      );
    } finally {
      delay = 0;
      delete process.env.AI_TIMEOUT_MS;
    }
  });
  await t.test('OpenAI retains JSON schema mode', async () => {
    process.env.AI_TEXT_PROVIDER = 'openai';
    const result = await aiModels.parse({
      ...input,
      response_format: zodResponseFormat(schema, 'result'),
    });
    assert.equal(result.choices[0].message.parsed.answer, 'ok');
    assert.equal(requests.at(-1).body.response_format.type, 'json_schema');
  });
  await t.test(
    'provider failures are not silently retried by default',
    async () => {
      const start = requests.length;
      status = 500;
      await assert.rejects(aiModels.complete(input));
      assert.equal(requests.length - start, 1);
      status = 200;
    }
  );
});
