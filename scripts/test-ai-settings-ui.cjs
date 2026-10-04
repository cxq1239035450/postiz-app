const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright');

test('AI settings browser interactions with mocked API', async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {AiSettingsComponent} from './apps/frontend/src/components/settings/ai-settings.component';
      createRoot(document.getElementById('root')).render(<form onSubmit={e=>{e.preventDefault();window.profileSubmitted=true}}><AiSettingsComponent/></form>);`,
      resolveDir: root,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'test-boundaries',
        setup(builder) {
          builder.onResolve(
            { filter: /custom\.fetch$|user\.context$/ },
            (args) => ({ path: args.path, namespace: 'test' })
          );
          builder.onLoad({ filter: /.*/, namespace: 'test' }, (args) => ({
            contents: args.path.endsWith('custom.fetch')
              ? 'export const useFetch=()=>window.testFetch;'
              : 'export const useUser=()=>({isSuperAdmin:window.testAdmin});',
            loader: 'js',
          }));
          builder.onResolve({ filter: /^@gitroom\/react\// }, (args) => ({
            path: path.join(
              root,
              'libraries/react-shared-libraries/src',
              args.path.replace('@gitroom/react/', '') + '.tsx'
            ),
          }));
        },
      },
    ],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const mount = async (admin) => {
      await page.goto('about:blank');
      await page.setContent('<div id="root"></div>');
      await page.evaluate((admin) => {
        window.testAdmin = admin;
        window.requests = [];
        window.fail = false;
        const settings = {
          revision: 'r1',
          text: {
            provider: 'openai-compatible',
            baseURL: 'https://relay.example/v1',
            model: 'test-model',
            hasKey: true,
          },
          image: {
            provider: 'openai',
            baseURL: 'https://api.openai.com/v1',
            model: 'test-image',
            hasKey: false,
          },
          chatModel: '',
          agentModel: '',
          classificationModel: '',
          timeout: 120000,
          maxRetries: 0,
        };
        window.testFetch = async (url, options = {}) => {
          window.requests.push({
            url,
            body: options.body ? JSON.parse(options.body) : null,
          });
          if (window.fail)
            return new Response(JSON.stringify({ message: '模拟保存失败' }), {
              status: 500,
              headers: { 'content-type': 'application/json' },
            });
          if (url.includes('/test/'))
            return new Response(
              JSON.stringify({ ok: true, message: '连接成功，未保存' })
            );
          if (options.method === 'POST') {
            const next = JSON.parse(options.body);
            Object.assign(settings, next, { revision: 'r2' });
            settings.text = { ...next.text, apiKey: undefined, hasKey: true };
            settings.image = {
              ...next.image,
              apiKey: undefined,
              hasKey: false,
            };
          }
          return new Response(JSON.stringify(settings));
        };
      }, admin);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
    };
    await mount(true);
    await page.getByLabel('文字模型名称', { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('文字模型API Key', { exact: true }).inputValue(),
      ''
    );
    await page
      .getByLabel('文字模型名称', { exact: true })
      .fill('changed-model');
    await page.getByLabel('文字模型名称', { exact: true }).press('Enter');
    assert.equal(await page.evaluate(() => !!window.profileSubmitted), false);
    await page
      .getByRole('button', { name: '测试文字模型', exact: true })
      .click();
    await page.getByRole('status').filter({ hasText: '连接成功' }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.requests.filter((r) => r.url === '/settings/ai' && r.body)
            .length
      ),
      0
    );
    await page
      .getByLabel('文字模型API Key', { exact: true })
      .fill('typed-secret');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '配置已保存' }).waitFor();
    const saved = await page.evaluate(
      () => window.requests.find((r) => r.url === '/settings/ai' && r.body).body
    );
    assert.equal(saved.text.model, 'changed-model');
    assert.equal(saved.text.apiKey, 'typed-secret');
    assert.equal(saved.text.hasKey, undefined);
    assert.equal(
      await page.getByLabel('文字模型API Key', { exact: true }).inputValue(),
      ''
    );
    await page.evaluate(() => {
      window.fail = true;
    });
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor();
    await mount(false);
    await page
      .getByText(
        '此配置影响整个实例，只有系统超级管理员可以查看和修改。工作区管理员不具备此权限。'
      )
      .waitFor();
    assert.equal(
      await page.getByRole('button', { name: '保存配置', exact: true }).count(),
      0
    );
    assert.equal(await page.evaluate(() => window.requests.length), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
