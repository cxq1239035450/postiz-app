require('ts-node').register({
  transpileOnly: true,
  project: require('node:path').join(__dirname, '../tsconfig.base.json'),
  compilerOptions: { module: 'commonjs', moduleResolution: 'node' },
});
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  AiSettingsService,
} = require('../libraries/nestjs-libraries/src/ai/ai.settings');

test('AI settings persistence and access boundaries', async (t) => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.ai-settings-test-'));
  const file = path.join(directory, '.env');
  t.after(() => {
    for (const name of fs.readdirSync(directory))
      fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  });
  const original =
    '# preserve this comment\r\nOTHER_SETTING="unchanged"\r\nAI_TEXT_PROVIDER="openai-compatible"\r\nAI_TEXT_BASE_URL="https://relay.example/v1"\r\nAI_TEXT_API_KEY="test-secret"\r\nAI_TEXT_MODEL="test-model"\r\nAI_IMAGE_PROVIDER="openai"\r\nAI_IMAGE_BASE_URL="https://api.openai.com/v1"\r\nAI_IMAGE_MODEL="test-image"\r\nAI_IMAGE_API_KEY="image-secret"\r\n';
  fs.writeFileSync(file, original);
  const service = new AiSettingsService(file);
  await t.test('container configuration can live on a persistent config volume', () => {
    const previous = process.env.AI_SETTINGS_FILE;
    process.env.AI_SETTINGS_FILE = file;
    try {
      assert.equal(new AiSettingsService().get().text.model, 'test-model');
      assert.equal(service.get().revision, new AiSettingsService().get().revision);
    } finally {
      if (previous === undefined) delete process.env.AI_SETTINGS_FILE;
      else process.env.AI_SETTINGS_FILE = previous;
    }
  });
  const draft = () => {
    const value = service.get();
    const channel = ({ hasKey, ...data }) => ({ ...data, apiKey: '' });
    return {
      revision: value.revision,
      text: channel(value.text),
      image: channel(value.image),
      chatModel: '',
      agentModel: '',
      classificationModel: '',
      timeout: 120000,
      maxRetries: 0,
    };
  };
  await t.test('only instance superadmins are allowed', () => {
    assert.throws(
      () => service.assertAdmin(undefined),
      (error) => error.getStatus() === 403
    );
    assert.throws(
      () => service.assertAdmin({ role: 'SUPERADMIN' }),
      (error) => error.getStatus() === 403
    );
    assert.doesNotThrow(() => service.assertAdmin({ isSuperAdmin: true }));
  });
  await t.test('read response never contains stored keys', () => {
    const value = service.get();
    assert.equal(value.text.hasKey, true);
    assert.equal(value.text.apiKey, undefined);
    assert(!JSON.stringify(value).includes('test-secret'));
    assert(!JSON.stringify(value).includes('image-secret'));
  });
  await t.test(
    'save preserves keys, unrelated settings and process configuration',
    () => {
      const input = draft();
      const before = process.env.AI_TEXT_MODEL;
      input.text.model = 'updated-model';
      const saved = service.save(input);
      const result = fs.readFileSync(file, 'utf8');
      assert(result.includes('AI_TEXT_API_KEY="test-secret"'));
      assert(result.includes('OTHER_SETTING="unchanged"'));
      assert(result.startsWith('# preserve this comment\r\n'));
      assert.equal(saved.text.model, 'updated-model');
      assert.equal(process.env.AI_TEXT_MODEL, before);
      assert.equal(saved.restartRequired, true);
      assert.throws(
        () => service.save(input),
        (error) => error.getStatus() === 409
      );
    }
  );
  await t.test('endpoint change cannot silently reuse a saved key', () => {
    const input = draft();
    input.text.baseURL = 'https://other.example/v1';
    assert.throws(
      () => service.save(input),
      (error) => error.getStatus() === 400
    );
    input.text.apiKey = 'new-test-key';
    const saved = service.save(input);
    assert.equal(saved.text.baseURL, input.text.baseURL);
    assert(!JSON.stringify(saved).includes('new-test-key'));
  });
  await t.test('reject env injection, extra fields and malformed URLs', () => {
    const input = draft();
    input.text.apiKey = 'key\nOTHER_SETTING=changed';
    assert.throws(() => service.save(input));
    assert.throws(() => service.save({ ...draft(), unrelated: 'value' }));
    const invalid = draft();
    invalid.text.baseURL = 'file:///etc/passwd';
    invalid.text.apiKey = 'replacement';
    assert.throws(() => service.save(invalid));
    assert(fs.readFileSync(file, 'utf8').includes('OTHER_SETTING="unchanged"'));
  });
});
