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
const Module = require('node:module');
const load = Module._load;
Module._load = function (request, ...args) {
  if (request === '@gitroom/nestjs-libraries/upload/upload.factory') {
    return { UploadFactory: { createStorage: () => ({}) } };
  }
  return load.call(this, request, ...args);
};
const { IntegrationRepository } = require('../libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository');
Module._load = load;

function fixture() {
  const channels = [
    { id: 'channel', organizationId: 'org', deletedAt: null, customerId: null },
    { id: 'foreign', organizationId: 'other', deletedAt: null },
    { id: 'deleted', organizationId: 'org', deletedAt: new Date() },
  ];
  const groups = [
    { id: 'group', orgId: 'org', name: 'Brand', deletedAt: null },
    { id: 'foreign-group', orgId: 'other', name: 'Foreign', deletedAt: null },
    { id: 'deleted-group', orgId: 'org', name: 'Deleted', deletedAt: new Date() },
  ];
  const calls = [];
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const customer = {
    findFirst: async ({ where }) => groups.find((row) => matches(row, where)),
    findMany: async ({ where }) => groups.filter((row) => matches(row, where)),
    create: async ({ data }) => {
      calls.push('create');
      const row = { ...data, id: `new-${groups.length}`, deletedAt: null };
      groups.push(row);
      return row;
    },
  };
  const integration = {
    findFirst: async ({ where }) => {
      calls.push('validate-channel');
      return channels.find((row) => matches(row, where));
    },
    update: async ({ where, data }) => {
      calls.push('update');
      const row = channels.find((item) => matches(item, where));
      assert.ok(row);
      if (data.customer.connect) {
        assert.deepEqual(Object.keys(data.customer.connect).sort(), ['deletedAt', 'id', 'orgId']);
        assert.ok(groups.find((item) => matches(item, data.customer.connect)));
      }
      assert.equal(where.deletedAt, null);
      row.customerId = data.customer.disconnect ? null : data.customer.connect.id;
      return row;
    },
  };
  return {
    repo: new IntegrationRepository({ model: { integration } }, {}, {}, {}, { model: { customer } }, {}),
    channels, groups, calls,
  };
}
const status = (expected) => (error) => error.getStatus() === expected;

test('only active groups belonging to the organization are listed', async () => {
  const { repo } = fixture();
  assert.deepEqual((await repo.customers('org')).map((row) => row.id), ['group']);
});
for (const id of ['foreign', 'deleted', 'missing']) {
  test(`invalid channel ${id} cannot create a group or move`, async () => {
    const { repo, calls } = fixture();
    await assert.rejects(repo.updateOnCustomerName('org', id, 'New brand'), status(404));
    await assert.rejects(repo.updateIntegrationGroup('org', id, 'group'), status(404));
    assert.ok(!calls.includes('create'));
    assert.ok(!calls.includes('update'));
  });
}
for (const group of ['foreign-group', 'deleted-group', 'missing']) {
  test(`invalid group ${group} cannot receive a channel`, async () => {
    const { repo, calls } = fixture();
    await assert.rejects(repo.updateIntegrationGroup('org', 'channel', group), status(404));
    assert.ok(!calls.includes('update'));
  });
}
test('move and empty-string disconnect preserve the response shape', async () => {
  const { repo } = fixture();
  assert.equal((await repo.updateIntegrationGroup('org', 'channel', 'group')).customerId, 'group');
  assert.equal((await repo.updateIntegrationGroup('org', 'channel', '')).customerId, null);
  await repo.updateIntegrationGroup('org', 'channel', 'group');
  assert.equal((await repo.updateOnCustomerName('org', 'channel', '')).customerId, null);
});
test('trimmed names reuse an active group and validate channel before creation', async () => {
  const { repo, calls, groups } = fixture();
  assert.equal((await repo.updateOnCustomerName('org', 'channel', ' Brand ')).customerId, 'group');
  assert.ok(!calls.includes('create'));
  calls.length = 0;
  await repo.updateOnCustomerName('org', 'channel', ' New brand ');
  assert.deepEqual(calls, ['validate-channel', 'create', 'update']);
  assert.equal(groups.at(-1).name, 'New brand');
});
test('deleted and foreign same-name groups are never reused', async () => {
  const { repo, groups } = fixture();
  await repo.updateOnCustomerName('org', 'channel', 'Deleted');
  assert.equal(groups.at(-1).name, 'Deleted');
  assert.equal(groups.at(-1).deletedAt, null);
  await repo.updateOnCustomerName('org', 'channel', 'Foreign');
  assert.equal(groups.at(-1).orgId, 'org');
});
test('malformed name and group inputs fail before writes; 64-character names work', async () => {
  const { repo, calls } = fixture();
  for (const name of [undefined, null, 5, {}, '   ', 'x'.repeat(65)]) {
    await assert.rejects(repo.updateOnCustomerName('org', 'channel', name), status(400));
  }
  for (const group of [undefined, null, 5, {}]) {
    await assert.rejects(repo.updateIntegrationGroup('org', 'channel', group), status(400));
  }
  assert.deepEqual(calls, []);
  assert.ok(await repo.updateOnCustomerName('org', 'channel', 'x'.repeat(64)));
});
