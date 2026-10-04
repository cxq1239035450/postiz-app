const { test } = require('node:test');
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
// Isolate infrastructure (database, workflow engine, Redis, email). Exercise
// production provider, transaction, controller and account-resolution logic.
const Module = require('node:module');
const load = Module._load;
const stubs = {
  '@gitroom/nestjs-libraries/database/prisma/users/users.service': {
    UsersService: class {},
  },
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service':
    { OrganizationService: class {} },
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service':
    { NotificationService: class {} },
  '@gitroom/nestjs-libraries/services/email.service': {
    EmailService: class {},
  },
  '@gitroom/nestjs-libraries/newsletter/newsletter.service': {
    NewsletterService: class {},
  },
  '@gitroom/nestjs-libraries/throttler/throttler.provider': {
    ThrottlerRealIpGuard: class {},
  },
};
Module._load = function (request, ...args) {
  return stubs[request] || load.call(this, request, ...args);
};
const {
  AuthService,
} = require('../apps/backend/src/services/auth/auth.service');
const {
  WebLoginController,
} = require('../apps/backend/src/api/routes/web-login.controller');
const {
  WebLoginService,
} = require('../apps/backend/src/services/auth/web-login/web-login.service');
const {
  GoogleLoginProvider,
} = require('../apps/backend/src/services/auth/web-login/google-login.provider');
const {
  WechatLoginProvider,
} = require('../apps/backend/src/services/auth/web-login/wechat-login.provider');
const {
  createLoginTransaction,
  verifyLoginTransaction,
} = require('../apps/backend/src/services/auth/web-login/login-transaction');
const {
  publicWebLoginConfig,
} = require('../libraries/helpers/src/auth/web-login.config');
Module._load = load;
const { sign, verify } = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

function response() {
  return {
    cookies: {},
    headers: {},
    cleared: [],
    setHeader(k, v) {
      this.headers[k] = v;
    },
    cookie(k, v, options) {
      this.cookies[k] = { value: v, options };
    },
    clearCookie(k, options) {
      this.cleared.push({ k, options });
    },
    redirect(status, url) {
      this.status = status;
      this.url = url;
      return this;
    },
  };
}

test('modular website login', async (t) => {
  const original = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env))
      if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  });
  Object.assign(process.env, {
    JWT_SECRET: 'test-only-long-random-secret-never-deploy',
    FRONTEND_URL: 'https://app.example.com',
    NEXT_PUBLIC_BACKEND_URL: 'https://app.example.com/api',
    GOOGLE_LOGIN_ENABLED: 'true',
    GOOGLE_LOGIN_CLIENT_ID: 'google-test-id',
    GOOGLE_LOGIN_CLIENT_SECRET: 'google-test-secret',
    WECHAT_LOGIN_ENABLED: 'true',
    WECHAT_LOGIN_CLIENT_ID: 'wechat-test-id',
    WECHAT_LOGIN_CLIENT_SECRET: 'wechat-test-secret',
  });
  const google = new GoogleLoginProvider();
  const wechat = new WechatLoginProvider();
  const providers = new WebLoginService(google, wechat);

  await t.test('independent configuration never exposes secrets', () => {
    assert.deepEqual(publicWebLoginConfig(), { google: true, wechat: true });
    process.env.WECHAT_LOGIN_ENABLED = 'false';
    assert.equal(providers.getProvider('wechat'), undefined);
    assert.equal(providers.getProvider('google'), google);
    assert.equal(providers.getProvider('unknown'), undefined);
    process.env.WECHAT_LOGIN_ENABLED = 'true';
    assert(!JSON.stringify(publicWebLoginConfig()).includes('secret'));
  });
  await t.test(
    'state validates browser, provider, signature, audience and expiry',
    () => {
      const { transaction, cookie } = createLoginTransaction('google');
      assert.equal(
        verifyLoginTransaction('google', transaction.state, cookie).nonce,
        transaction.nonce
      );
      assert.throws(() =>
        verifyLoginTransaction('wechat', transaction.state, cookie)
      );
      assert.throws(() =>
        verifyLoginTransaction('google', '0'.repeat(48), cookie)
      );
      assert.throws(() =>
        verifyLoginTransaction('google', transaction.state, undefined)
      );
      assert.throws(() =>
        verifyLoginTransaction('google', [transaction.state], cookie)
      );
      assert.throws(() =>
        verifyLoginTransaction('google', transaction.state, cookie + 'tampered')
      );
      const expired = sign(transaction, process.env.JWT_SECRET, {
        audience: 'qpublish-web-login',
        expiresIn: -1,
      });
      assert.throws(() =>
        verifyLoginTransaction('google', transaction.state, expired)
      );
      const wrongAudience = sign(transaction, process.env.JWT_SECRET, {
        audience: 'auth',
      });
      assert.throws(() =>
        verifyLoginTransaction('google', transaction.state, wrongAudience)
      );
    }
  );
  await t.test(
    'Google authorization uses login-only scopes, nonce and PKCE',
    () => {
      const { transaction } = createLoginTransaction('google');
      const url = new URL(google.authorizationUrl(transaction));
      assert.equal(url.hostname, 'accounts.google.com');
      assert.equal(url.searchParams.get('state'), transaction.state);
      assert.equal(url.searchParams.get('nonce'), transaction.nonce);
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(
        url.searchParams.get('redirect_uri'),
        'https://app.example.com/api/auth/social/google/callback'
      );
      assert.equal(url.searchParams.get('scope'), 'openid email profile');
      assert(!url.href.includes('secret'));
    }
  );
  await t.test(
    'Google requires verified email and matching signed-token nonce',
    async () => {
      const originalToken = OAuth2Client.prototype.getToken,
        originalVerify = OAuth2Client.prototype.verifyIdToken;
      const { transaction } = createLoginTransaction('google');
      let identity = {
        sub: 'google-sub',
        email: 'Alice@Example.com',
        email_verified: true,
        nonce: transaction.nonce,
      };
      OAuth2Client.prototype.getToken = async (params) => {
        assert.equal(params.codeVerifier, transaction.verifier);
        return { tokens: { id_token: 'verified-on-server' } };
      };
      OAuth2Client.prototype.verifyIdToken = async (params) => {
        assert.equal(params.audience, 'google-test-id');
        return { getPayload: () => identity };
      };
      try {
        assert.equal(
          (await google.exchange('code', transaction)).email,
          'alice@example.com'
        );
        identity = { ...identity, email_verified: false };
        await assert.rejects(google.exchange('code', transaction));
        identity = { ...identity, email_verified: true, nonce: 'wrong' };
        await assert.rejects(google.exchange('code', transaction));
      } finally {
        OAuth2Client.prototype.getToken = originalToken;
        OAuth2Client.prototype.verifyIdToken = originalVerify;
      }
    }
  );
  await t.test(
    'WeChat uses website QR scope and validates OpenID through userinfo',
    async () => {
      const { transaction } = createLoginTransaction('wechat');
      const url = new URL(wechat.authorizationUrl(transaction));
      assert.equal(url.pathname, '/connect/qrconnect');
      assert.equal(url.searchParams.get('scope'), 'snsapi_login');
      assert.equal(url.searchParams.get('appid'), 'wechat-test-id');
      assert(!url.href.includes('secret'));
      const originalFetch = global.fetch;
      let wrongUser = false;
      let tokenError = false;
      global.fetch = async (url) => ({
        ok: true,
        json: async () =>
          String(url).includes('/access_token?')
            ? tokenError
              ? { errcode: 40029 }
              : { access_token: 'server-only', openid: 'wx-openid' }
            : { openid: wrongUser ? 'wrong' : 'wx-openid', nickname: '创作者' },
      });
      try {
        const identity = await wechat.exchange('code', transaction);
        assert.equal(identity.id, 'wechat-test-id:wx-openid');
        assert.equal(identity.email, undefined);
        wrongUser = true;
        await assert.rejects(wechat.exchange('code', transaction));
        tokenError = true;
        await assert.rejects(wechat.exchange('code', transaction));
      } finally {
        global.fetch = originalFetch;
      }
    }
  );
  await t.test(
    'callbacks reject missing state before any provider exchange',
    async () => {
      let exchanged = false;
      const controller = new WebLoginController(
        {
          getProvider: () => ({
            id: 'google',
            exchange: () => {
              exchanged = true;
            },
          }),
        },
        {}
      );
      const res = response();
      await controller.callback(
        'google',
        { code: 'code', state: 'bad' },
        { cookies: {} },
        res,
        '127.0.0.1',
        'test'
      );
      assert.equal(exchanged, false);
      assert(res.url.endsWith('error=invalid_state'));
      assert.equal(res.cookies.auth, undefined);
    }
  );
  await t.test(
    'disabled provider and cancellation are safe redirects',
    async () => {
      const controller = new WebLoginController(providers, {});
      const missing = response();
      controller.start('unknown', missing);
      assert(missing.url.endsWith('error=provider_unavailable'));
      const start = response();
      controller.start('google', start);
      const state = new URL(start.url).searchParams.get('state');
      assert(start.cookies.qpublish_login_google.options.httpOnly);
      assert.equal(start.cookies.qpublish_login_google.options.sameSite, 'lax');
      const cancelled = response();
      await controller.callback(
        'google',
        { state, error: 'access_denied' },
        {
          cookies: {
            qpublish_login_google: start.cookies.qpublish_login_google.value,
          },
        },
        cancelled,
        '',
        ''
      );
      assert(cancelled.url.endsWith('error=access_denied'));
    }
  );
  await t.test(
    'successful callback sets httpOnly session and preserves invite organization',
    async () => {
      const { transaction, cookie } = createLoginTransaction('wechat');
      const controller = new WebLoginController(
        {
          getProvider: () => ({
            id: 'wechat',
            exchange: async () => ({ id: 'wx' }),
          }),
        },
        {
          loginVerifiedIdentity: async (provider, identity, ip, agent, org) => {
            assert.equal(provider, 'WECHAT');
            assert.equal(org, 'invite');
            return {
              jwt: 'session-only',
              addedOrg: { organizationId: 'org-1' },
              isNew: true,
            };
          },
        }
      );
      const res = response();
      await controller.callback(
        'wechat',
        { code: 'code', state: transaction.state },
        { cookies: { qpublish_login_wechat: cookie, org: 'invite' } },
        res,
        '',
        ''
      );
      assert(res.cookies.auth.options.httpOnly);
      assert(res.cookies.auth.options.secure);
      assert.equal(res.cookies.showorg.value, 'org-1');
      assert(!res.url.includes('session-only'));
      assert.equal(res.url, 'https://app.example.com/launches?onboarding=true');
    }
  );
  await t.test('provider failures do not expose upstream secrets', async () => {
    const { transaction, cookie } = createLoginTransaction('google');
    const controller = new WebLoginController(
      {
        getProvider: () => ({
          id: 'google',
          exchange: async () => {
            throw new Error('secret-from-upstream');
          },
        }),
      },
      {}
    );
    const res = response();
    await controller.callback(
      'google',
      { code: 'code', state: transaction.state },
      { cookies: { qpublish_login_google: cookie } },
      res,
      '',
      ''
    );
    assert(res.url.endsWith('error=login_failed'));
    assert(!JSON.stringify(res).includes('secret-from-upstream'));
  });
  await t.test(
    'verified identity reuses existing account without email-based merging',
    async () => {
      const service = new AuthService(
        {
          getUserByProvider: async (id, provider) => {
            assert.equal(id, 'google-sub');
            assert.equal(provider, 'GOOGLE');
            return {
              id: 'user-1',
              activated: true,
              password: 'never-in-session',
            };
          },
        },
        {
          createOrgAndUser: () => assert.fail('must not create existing user'),
        },
        {},
        {},
        {}
      );
      const result = await service.loginVerifiedIdentity(
        'GOOGLE',
        { id: 'google-sub', email: 'alice@example.com' },
        '',
        ''
      );
      assert.equal(result.isNew, false);
      const session = verify(result.jwt, process.env.JWT_SECRET);
      assert.equal(session.id, 'user-1');
      assert.equal(session.password, undefined);
    }
  );
  await t.test(
    'new WeChat account uses a stable .invalid identifier and obeys closed registration',
    async () => {
      let body;
      const service = new AuthService(
        { getUserByProvider: async () => null },
        {
          getCount: async () => 1,
          createOrgAndUser: async (data) => {
            body = data;
            return { users: [{ user: { id: 'user-wx', activated: true } }] };
          },
        },
        {},
        {},
        {}
      );
      process.env.DISABLE_REGISTRATION = 'true';
      await assert.rejects(
        service.loginVerifiedIdentity('WECHAT', { id: 'app:openid' }, '', ''),
        /Registration is disabled/
      );
      assert.equal(body, undefined);
      process.env.DISABLE_REGISTRATION = 'false';
      await service.loginVerifiedIdentity(
        'WECHAT',
        { id: 'app:openid', name: '测试' },
        '',
        ''
      );
      assert.match(body.email, /^[a-f0-9]{64}@wechat\.invalid$/);
      assert.equal(body.providerId, 'app:openid');
      assert.equal(body.password, '');
    }
  );
});
