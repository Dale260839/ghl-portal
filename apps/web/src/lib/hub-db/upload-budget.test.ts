import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeUploadBudget, uploadActor } from './upload-budget.ts';
import { HubStorage } from './storage.ts';

const scope = { contractorId: 'c1', authProfileIds: ['p1'], locationId: 'loc1' };
const actor = uploadActor({ role: 'field', name: 'Staff', email: '', membershipId: 'member1' });
const config = { url: 'https://hub.example.test', key: 'test-only' };
test('upload actors are stable identifiers, not names', () => {
  assert.notEqual(actor, uploadActor({ role: 'field', name: 'Staff', email: '', membershipId: 'member2' }));
  assert.throws(() => uploadActor({ role: 'field', name: 'Staff', email: '' }), /identity/);
});
test('budget RPC carries tenant, stable actor and reserved bytes', async () => {
  let body: unknown;
  await consumeUploadBudget(config, scope, actor, 42, (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ allowed: true }));
  }) as typeof fetch);
  assert.deepEqual(body, { p_contractor_id: 'c1', p_actor_key: actor, p_bytes: 42 });
});
test('refusals, missing migration and oversized uploads all fail closed', async () => {
  const deny = (async () => new Response(JSON.stringify({ allowed: false }))) as typeof fetch;
  const missing = (async () => new Response('{}', { status: 404 })) as typeof fetch;
  await assert.rejects(consumeUploadBudget(config, scope, actor, 10, deny), /allowance/);
  await assert.rejects(consumeUploadBudget(config, scope, actor, 10, missing), /unavailable/);
  await assert.rejects(consumeUploadBudget(config, scope, actor, 3_500_001, deny), /3.5 MB/);
});
test('no storage bytes are posted unless the durable budget succeeds', async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    requests.push(url);
    return new Response(JSON.stringify({ allowed: false }));
  });
  const storage = new HubStorage(config.url, config.key);
  await assert.rejects(storage.upload(scope, {
    projectId: 'p1', kind: 'photos', filename: 'photo.jpg', contentType: 'image/jpeg',
    body: new Uint8Array([1]), actorId: actor,
  }), /allowance/);
  assert.deepEqual(requests, [config.url + '/rest/v1/rpc/hub_claim_upload']);
});
