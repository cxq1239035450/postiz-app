const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function provider(fetch) {
  const exports = {};
  const source = readFileSync(join(__dirname, '../libraries/nestjs-libraries/src/integrations/social/tiktok.provider.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  vm.runInNewContext(code, { exports, fetch, require: (name) => {
    if (name.endsWith('social.abstract')) return { SocialAbstract: class {} };
    if (name.endsWith('rules.description.decorator')) return { Rules: () => (target) => target };
    return {};
  } });
  return new exports.TiktokProvider();
}
const data = { privacy_level_options: ['SELF_ONLY'], comment_disabled: true, duet_disabled: false, stitch_disabled: true, max_video_post_duration_sec: 60, creator_username: 'qa', creator_nickname: 'QA' };
test('creator permissions preserve exact account restrictions and omit unrelated payload', async () => {
  const service = provider(async (url, options) => {
    assert.equal(url, 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { ok: true, json: async () => ({ error: { code: 'ok' }, data: { ...data, secret: 'not-returned' } }) };
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await service.creatorInfo('test-token'))), data);
});
test('permission failures and malformed creator payload never receive permissive defaults', async () => {
  for (const body of [
    { error: { code: 'access_token_invalid' }, data },
    { error: { code: 'ok' }, data: { ...data, privacy_level_options: null } },
    { error: { code: 'ok' }, data: { ...data, comment_disabled: undefined } },
    { error: { code: 'ok' }, data: { ...data, max_video_post_duration_sec: 0 } },
  ]) {
    const service = provider(async () => ({ ok: true, json: async () => body }));
    await assert.rejects(service.creatorInfo('test-token'), /permissions are unavailable/);
  }
  await assert.rejects(provider(async () => ({ ok: false, json: async () => ({error:{code:'ok'},data}) })).creatorInfo('test-token'));
});
