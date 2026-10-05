const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('reflect-metadata');
require('ts-node').register({
  transpileOnly: true,
  project: path.join(__dirname, '../tsconfig.base.json'),
  compilerOptions: { module: 'commonjs', moduleResolution: 'node' },
});
require('tsconfig-paths').register({
  baseUrl: path.join(__dirname, '..'),
  paths: require('../tsconfig.base.json').compilerOptions.paths,
});
delete process.env.REDIS_URL;
const Module = require('node:module');
const originalLoad = Module._load;
const cache = new Map();
Module._load = function (request, ...args) {
  if (request === '@gitroom/nestjs-libraries/redis/redis.service')
    return {
      ioRedis: {
        get: async (key) => cache.get(key),
        set: async (key, value) => cache.set(key, value),
      },
    };
  if (request === '@gitroom/nestjs-libraries/database/prisma/prisma.service')
    return { PrismaService: class {} };
  return originalLoad.call(this, request, ...args);
};
const {
  WebsiteAnalyticsService,
} = require('../apps/backend/src/services/website-analytics/website-analytics.service');
Module._load = originalLoad;
let db, service, sessions, connections, requests;
const matches = (row, where) =>
  Object.entries(where).every(([key, value]) =>
    value && typeof value === 'object'
      ? value.gt
        ? row[key] > value.gt
        : value.lt
        ? row[key] < value.lt
        : false
      : row[key] === value
  );
beforeEach(() => {
  cache.clear();
  process.env.SEARCH_CONSOLE_CLIENT_ID = 'test-client';
  process.env.SEARCH_CONSOLE_CLIENT_SECRET = 'test-secret';
  process.env.SEARCH_CONSOLE_ENCRYPTION_KEY = 'ab'.repeat(32);
  process.env.FRONTEND_URL = 'https://example.test';
  sessions = [];
  connections = [];
  requests = [];
  db = {
    websiteAuthorization: {
      create: async ({ data }) => {
        sessions.push(data);
        return data;
      },
      findFirst: async ({ where }) =>
        sessions.find((row) => matches(row, where)),
      deleteMany: async ({ where }) => {
        const length = sessions.length;
        sessions = sessions.filter((row) => !matches(row, where));
        return { count: length - sessions.length };
      },
    },
    websiteConnection: {
      findFirst: async ({ where }) =>
        connections.find((row) => matches(row, where)),
      findMany: async ({ where, select }) =>
        connections
          .filter((row) => matches(row, where))
          .map((row) =>
            Object.fromEntries(
              Object.keys(select).map((key) => [key, row[key]])
            )
          ),
      updateMany: async ({ where, data }) => {
        const found = connections.filter((row) => matches(row, where));
        found.forEach((row) => Object.assign(row, data));
        return { count: found.length };
      },
      deleteMany: async ({ where }) => {
        const length = connections.length;
        connections = connections.filter((row) => !matches(row, where));
        return { count: length - connections.length };
      },
      upsert: async ({ where, create, update }) => {
        const row = connections.find((row) =>
          matches(row, where.organizationId_siteUrl)
        );
        if (row) return Object.assign(row, update);
        const created = {
          id: require('crypto').randomUUID(),
          updatedAt: new Date(),
          reconnectRequired: false,
          ...create,
        };
        connections.push(created);
        return created;
      },
    },
    $transaction: async (fn) => fn(db),
  };
  service = new WebsiteAnalyticsService(db);
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/token'))
      return Response.json({
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        expires_in: 3600,
      });
    if (url.endsWith('/sites'))
      return Response.json({
        siteEntry: [
          { siteUrl: 'sc-domain:example.test', permissionLevel: 'siteOwner' },
          { siteUrl: 'https://example.test/', permissionLevel: 'siteFullUser' },
          {
            siteUrl: 'sc-domain:denied.test',
            permissionLevel: 'siteUnverifiedUser',
          },
        ],
      });
    const body = JSON.parse(options.body);
    const rows = body.dimensions
      ? [
          {
            keys: [body.dimensions[0] === 'date' ? '2026-09-01' : 'sample'],
            clicks: 5,
            impressions: 100,
            ctr: 0.05,
            position: 8,
          },
        ]
      : [{ clicks: 123, impressions: 1000, ctr: 0.123, position: 4 }];
    return Response.json({ rows });
  };
});
async function grant(org = 'org-a', user = 'user-a') {
  const { url } = await service.authorize(org, user);
  const state = new URL(url).searchParams.get('state');
  return { state, ...(await service.callback(org, user, state, 'code')) };
}
async function bound() {
  const { ticket } = await grant();
  await service.bind('org-a', 'user-a', ticket, ['sc-domain:example.test']);
  return connections[0];
}
test('OAuth requests only read-only scope, PKCE, and a distinct callback; state rejects other users/orgs and replay', async () => {
  const { url } = await service.authorize('org-a', 'user-a');
  const params = new URL(url).searchParams;
  assert.equal(
    params.get('scope'),
    'https://www.googleapis.com/auth/webmasters.readonly'
  );
  assert.equal(
    params.get('redirect_uri'),
    'https://example.test/website-analytics/connect'
  );
  assert.equal(params.get('code_challenge_method'), 'S256');
  const state = params.get('state');
  await assert.rejects(service.callback('org-b', 'user-a', state, 'code'));
  await assert.rejects(service.callback('org-a', 'user-b', state, 'code'));
  const results = await Promise.allSettled([
    service.callback('org-a', 'user-a', state, 'code'),
    service.callback('org-a', 'user-a', state, 'code'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await assert.rejects(service.callback('org-a', 'user-a', state, 'code'));
});
test('cancelled or expired authorization cannot be reused', async () => {
  let { url } = await service.authorize('a', 'b');
  const state = new URL(url).searchParams.get('state');
  await assert.rejects(
    service.callback('a', 'b', state, undefined, 'access_denied')
  );
  await assert.rejects(service.callback('a', 'b', state, 'code'));
  ({ url } = await service.authorize('a', 'b'));
  sessions[0].expiresAt = new Date(0);
  await assert.rejects(
    service.callback('a', 'b', new URL(url).searchParams.get('state'), 'code')
  );
  assert.equal(requests.length, 0);
});
test('selection validates live permissions, supports multiple resources, encrypts credentials and deduplicates', async () => {
  const { ticket, sites } = await grant();
  assert.equal(sites.length, 2);
  await assert.rejects(
    service.bind('org-b', 'user-a', ticket, [sites[0].siteUrl])
  );
  await assert.rejects(
    service.bind('org-a', 'user-a', ticket, ['sc-domain:denied.test'])
  );
  await service.bind(
    'org-a',
    'user-a',
    ticket,
    sites.map((s) => s.siteUrl)
  );
  assert.equal(connections.length, 2);
  assert.ok(!connections[0].credentials.includes('secret'));
  await assert.rejects(
    service.bind('org-a', 'user-a', ticket, [sites[0].siteUrl])
  );
  const next = await grant();
  await service.bind('org-a', 'user-a', next.ticket, [sites[0].siteUrl]);
  assert.equal(connections.length, 2);
  assert.ok(
    !JSON.stringify(await service.list('org-a')).includes('credentials')
  );
});
test('cross-org query and disconnect cannot access a connection or its cached results', async () => {
  const row = await bound();
  await service.report('org-a', row.id, '2026-09-01', '2026-09-28');
  await assert.rejects(
    service.report('org-b', row.id, '2026-09-01', '2026-09-28')
  );
  await service.disconnect('org-b', row.id);
  assert.equal(connections.length, 1);
  await service.disconnect('org-a', row.id);
  await assert.rejects(
    service.report('org-a', row.id, '2026-09-01', '2026-09-28')
  );
});
test('totals are independent from details, final Pacific dates and cache prevent repeated queries', async () => {
  const row = await bound();
  requests = [];
  const result = await service.report(
    'org-a',
    row.id,
    '2026-09-01',
    '2026-09-28',
    'page',
    1
  );
  assert.equal(result.totals.clicks, 123);
  assert.equal(result.rows[0].clicks, 5);
  assert.equal(result.timezone, 'America/Los_Angeles');
  const queries = requests.map((r) => JSON.parse(r.options.body));
  assert.ok(!queries[0].dimensions);
  assert.ok(queries.every((q) => q.dataState === 'final' && q.type === 'web'));
  assert.equal(queries[2].startRow, 50);
  await service.report('org-a', row.id, '2026-09-01', '2026-09-28', 'page', 1);
  assert.equal(requests.length, 3);
  await assert.rejects(
    service.report('org-a', row.id, '2026-02-30', '2026-03-03')
  );
  await assert.rejects(
    service.report('org-a', row.id, '2026-09-01', '2026-09-28', 'invalid')
  );
  await assert.rejects(
    service.report('org-a', row.id, '2026-09-01', '2026-09-28', 'page', -1)
  );
});
test('expired token refreshes; revoked refresh marks connection for reconnect', async () => {
  const row = await bound();
  row.credentials = service.encrypt({
    accessToken: 'old',
    refreshToken: 'refresh',
    expiresAt: 0,
  });
  await service.report('org-a', row.id, '2026-09-01', '2026-09-28');
  assert.ok(
    requests.some(
      (r) =>
        r.url.includes('/token') &&
        r.options.body.get('grant_type') === 'refresh_token'
    )
  );
  row.credentials = service.encrypt({
    accessToken: 'old',
    refreshToken: 'revoked',
    expiresAt: 0,
  });
  global.fetch = async () =>
    Response.json({ error: 'invalid_grant' }, { status: 400 });
  await assert.rejects(
    service.report('org-a', row.id, '2026-08-01', '2026-08-28'),
    (e) => e.getStatus() === 409
  );
  assert.equal(row.reconnectRequired, true);
});
test('quota errors remain retryable and never revoke a valid connection', async () => {
  const row = await bound();
  global.fetch = async () =>
    Response.json(
      { error: { errors: [{ reason: 'userRateLimitExceeded' }] } },
      { status: 403 }
    );
  await assert.rejects(
    service.report('org-a', row.id, '2026-09-01', '2026-09-28'),
    (e) => e.getStatus() === 429
  );
  assert.equal(row.reconnectRequired, false);
});
test('no sites and no data return explicit empty states', async () => {
  const original = global.fetch;
  global.fetch = async (url, options) =>
    url.endsWith('/sites') ? Response.json({}) : original(url, options);
  assert.deepEqual((await grant()).sites, []);
  global.fetch = original;
  const row = await bound();
  global.fetch = async () => Response.json({});
  const report = await service.report(
    'org-a',
    row.id,
    '2026-09-01',
    '2026-09-28'
  );
  assert.equal(report.totals, null);
  assert.deepEqual(report.rows, []);
});
test('reconnect validates ownership and same site before replacing credentials', async () => {
  const row = await bound();
  await assert.rejects(service.authorize('org-b', 'user-b', row.id));
  const { url } = await service.authorize('org-a', 'user-a', row.id);
  assert.deepEqual(
    await service.callback(
      'org-a',
      'user-a',
      new URL(url).searchParams.get('state'),
      'new-code'
    ),
    { reconnected: true }
  );
  assert.equal(connections.length, 1);
});
