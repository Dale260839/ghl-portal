import assert from 'node:assert/strict';
import test from 'node:test';

import { HubClient } from './client.ts';
import { resetColumnSupport } from './column-support.ts';
import { HubGhlAgency } from './ghl-agency.ts';

function fakeStore() {
  resetColumnSupport();
  const rows = new Map<string, Record<string, unknown>>();
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const request = new URL(String(url));
    if (init.method === 'POST') {
      assert.equal(request.searchParams.get('on_conflict'), 'company_id,client_id');
      const [row] = JSON.parse(String(init.body)) as Record<string, unknown>[];
      assert.ok(row);
      rows.set(`${row.company_id}:${row.client_id}`, row);
      return new Response(JSON.stringify([row]), { status: 200 });
    }
    if (request.searchParams.get('limit') === '0') {
      return new Response('[]', { status: 200 });
    }
    const clientId = request.searchParams.get('client_id')?.replace(/^eq\./, '');
    const found = [...rows.values()].filter((row) => row.client_id === clientId);
    return new Response(JSON.stringify(found), { status: 200 });
  }) as unknown as typeof fetch;
  const client = new HubClient({ url: 'https://hub.example', key: 'secret' }, { fetchImpl });
  return { store: new HubGhlAgency(client), rows };
}

function install(clientId: string, refreshToken: string) {
  return {
    companyId: 'company-1',
    clientId,
    refreshToken,
    accessToken: null,
    accessExpiresAt: null,
    scopes: null,
    installedBy: 'owner',
  };
}

for (const order of [
  ['location-app', 'signin-app'],
  ['signin-app', 'location-app'],
]) {
  test(`agency installs coexist when saved ${order.join(' then ')}`, async () => {
    const { store, rows } = fakeStore();
    await store.save(install(order[0]!, 'first-token'));
    await store.save(install(order[1]!, 'second-token'));

    assert.equal(rows.size, 2);
    assert.equal((await store.read(order[0]!))?.refreshToken, 'first-token');
    assert.equal((await store.read(order[1]!))?.refreshToken, 'second-token');

    await store.save(install(order[0]!, 'rotated-token'));
    assert.equal(rows.size, 2);
    assert.equal((await store.read(order[0]!))?.refreshToken, 'rotated-token');
    assert.equal((await store.read(order[1]!))?.refreshToken, 'second-token');
  });
}
