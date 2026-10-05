const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { build } = require('esbuild');
const { chromium } = require('playwright');

test('website analytics browser flow with mocked API', async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {WebsiteAnalytics} from './apps/frontend/src/components/website-analytics/website-analytics';
      import {WebsiteConnect} from './apps/frontend/src/components/website-analytics/website-connect';
      createRoot(document.getElementById('root')).render(window.connectMode ? <WebsiteConnect/> : <WebsiteAnalytics/>);`,
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
            { filter: /custom\.fetch$|platform\.analytics$|^next\/link$/ },
            (args) => ({ path: args.path, namespace: 'test' })
          );
          builder.onLoad({ filter: /.*/, namespace: 'test' }, (args) => ({
            contents: args.path.endsWith('custom.fetch')
              ? 'export const useFetch=()=>window.testFetch;'
              : args.path === 'next/link'
              ? 'export default function Link(){return null}'
              : 'export const PlatformAnalytics=()=>null;',
            loader: 'js',
          }));
        },
      },
    ],
  });
  const config = require('../apps/frontend/tailwind.config.cjs');
  const postcss = require('postcss');
  const css = await postcss([
    require('tailwindcss')({
      ...config,
      content: [
        path.join(root, 'apps/frontend/src/components/website-analytics/*.tsx'),
      ],
    }),
  ]).process('@tailwind base; @tailwind components; @tailwind utilities;', {
    from: undefined,
  });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 960 },
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://website-ui.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html><body><div id="root"></div></body></html>',
      })
    );
    async function mount(mode = 'dashboard') {
      await page.goto(
        `https://website-ui.test/${mode}?state=test-state&code=test-code`
      );
      await page.addStyleTag({
        content:
          css.css +
          ':root {--new-btn-text:#eee;--color-forth:#6831d8;--color-table-border:#38343d;--new-table-header:#242127;--new-bg-color-inner:#18161c;} body{background:#18161c;color:#eee;font-family:Arial,sans-serif}button{cursor:pointer}button:disabled{opacity:.4}option{color:#eee;background:#222}',
      });
      await page.evaluate((mode) => {
        window.connectMode = mode === 'connect';
        window.calls = [];
        window.fail = false;
        window.empty = false;
        window.sites = [
          {
            id: 'site1',
            siteUrl: 'sc-domain:example.test',
            reconnectRequired: false,
          },
          {
            id: 'site2',
            siteUrl: 'https://shop.example.test/',
            reconnectRequired: false,
          },
        ];
        window.testFetch = async (url, options = {}) => {
          const body = options.body ? JSON.parse(options.body) : null;
          window.calls.push({ url, method: options.method, body });
          if (url.endsWith('/callback'))
            return Response.json({
              ticket: 'test-ticket',
              sites: window.sites.map((site) => ({
                siteUrl: site.siteUrl,
                permissionLevel: 'siteOwner',
              })),
            });
          if (url.endsWith('/authorize'))
            return Response.json(
              { message: '模拟：需要管理员配置' },
              { status: 503 }
            );
          if (options.method === 'DELETE') {
            window.sites = window.sites.filter(
              (site) => !url.includes(site.id)
            );
            return Response.json({ success: true });
          }
          if (url === '/website-analytics/connections')
            return Response.json(
              { message: '模拟：绑定失败，可重试' },
              { status: 503 }
            );
          if (url === '/website-analytics')
            return Response.json({ enabled: true, websites: window.sites });
          if (window.fail)
            return Response.json(
              { message: '模拟：Google 授权已失效，请重新连接。' },
              { status: 409 }
            );
          const params = new URL(url, location.origin).searchParams;
          const totals = {
            clicks: 1234,
            impressions: 45678,
            ctr: 0.027,
            position: 8.2,
          };
          const row = {
            ...totals,
            keys: [
              params.get('dimension') === 'page'
                ? 'https://example.test/product'
                : 'example keyword',
            ],
          };
          return Response.json({
            totals: window.empty ? null : totals,
            rows: window.empty ? [] : [row],
            trend: [
              { ...totals, keys: ['2026-09-01'] },
              { ...totals, clicks: 1600, keys: ['2026-09-02'] },
            ],
            hasNext: params.get('page') === '0',
            updatedAt: new Date().toISOString(),
            startDate: params.get('startDate'),
            endDate: params.get('endDate'),
          });
        };
      }, mode);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
    }
    await mount();
    await page
      .getByRole('cell', { name: 'example keyword', exact: true })
      .waitFor();
    await page.getByRole('tab', { name: '页面', exact: true }).click();
    await page
      .getByRole('cell', { name: 'https://example.test/product', exact: true })
      .waitFor();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.getByText('第 2 页', { exact: true }).waitFor();
    await page.getByLabel('选择网站').selectOption('site2');
    await page.getByText('第 1 页', { exact: true }).waitFor();
    await page.getByLabel('日期范围').selectOption('custom');
    await page.getByLabel('开始日期').fill('2026-09-01');
    await page.getByLabel('结束日期').fill('2026-09-20');
    await page.getByRole('button', { name: '应用', exact: true }).click();
    await page.waitForFunction(() =>
      window.calls.some(
        (call) =>
          call.url.includes('startDate=2026-09-01') &&
          call.url.includes('endDate=2026-09-20')
      )
    );
    await page
      .getByRole('cell', { name: 'https://example.test/product', exact: true })
      .waitFor();
    await fs.mkdir(path.join(root, 'output/website-analytics'), {
      recursive: true,
    });
    await page.screenshot({
      path: path.join(root, 'output/website-analytics/dashboard.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(root, 'output/website-analytics/mobile.png'),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      ),
      JSON.stringify(
        await page.evaluate(() =>
          [...document.querySelectorAll('*')]
            .filter(
              (el) =>
                el.getBoundingClientRect().right > innerWidth + 1 &&
                !el.closest('table')
            )
            .map((el) => ({
              tag: el.tagName,
              class: el.className,
              width: el.getBoundingClientRect().width,
            }))
        )
      )
    );
    await page.getByRole('button', { name: '重新授权', exact: true }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: '模拟：需要管理员配置' })
      .waitFor();
    assert.ok(
      await page.evaluate(() =>
        window.calls.some((call) => call.body?.reconnectId === 'site2')
      )
    );
    await page.getByRole('button', { name: '解除绑定', exact: true }).click();
    await page.getByRole('button', { name: '确认解除', exact: true }).click();
    await page.waitForFunction(() => window.sites.length === 1);
    await page.evaluate(() => {
      window.fail = true;
    });
    await page.getByLabel('日期范围').selectOption('7');
    await page
      .getByRole('alert')
      .filter({ hasText: 'Google 授权已失效' })
      .waitFor();
    await page.evaluate(() => {
      window.fail = false;
      window.empty = true;
    });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page
      .getByText(
        '所选范围暂无已完成处理的搜索数据。新网站或最近日期可能尚无数据。'
      )
      .waitFor();
    await mount('connect');
    await page.getByRole('checkbox').first().check();
    await page.getByRole('checkbox').nth(1).check();
    await page
      .getByRole('button', { name: '绑定 2 个网站', exact: true })
      .click();
    await page
      .getByRole('alert')
      .filter({ hasText: '模拟：绑定失败' })
      .waitFor();
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.calls.find(
            (call) => call.url === '/website-analytics/connections'
          ).body.siteUrls
      ),
      ['sc-domain:example.test', 'https://shop.example.test/']
    );
    assert.equal(await page.evaluate(() => location.search), '');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
