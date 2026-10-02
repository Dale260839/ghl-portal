import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { sign } from '../apps/web/src/lib/auth/session-crypto.ts';

const base = new URL(process.env.PILOT_TEST_URL || 'http://127.0.0.1:3117');
const secret = process.env.PILOT_TEST_SECRET;
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Stress tests must stay on loopback.');
assert.ok(secret?.length >= 32, 'Supply the isolated server secret, never a production secret.');
const crew = {
  role: 'field', name: 'Stress fixture crew', email: 'crew@example.test',
  authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40'],
  ghlLocationId: 'loc_alliance_pro', ghlUserId: 'local-only', ghlIdentityVerified: true,
};
const cookie = (claims, options) => 'bs_session_hub=' + sign(claims, secret, options);
const cases = [
  { name: 'unsigned GHL URL', path: '/api/auth/ghl?json=1&locationId=fixture-location', check: async (response) => {
    // The existing JSON landing contract uses 200 with ok:false for refusals.
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal((await response.json()).ok, false);
  } },
  { name: 'untrusted GHL origin', path: '/api/auth/ghl?json=1', init: {
    method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ encryptedData: '{}', locationId: 'fixture-location' }),
  }, check: async (response) => {
    assert.ok([403, 429].includes(response.status));
    assert.equal(response.headers.get('set-cookie'), null);
  } },
  { name: 'anonymous files', path: '/api/files?path=foreign/project/documents/private.pdf', check: async (response) => {
    assert.equal(response.status, 401);
  } },
  { name: 'tampered session', path: '/api/session', init: { headers: { Cookie: cookie(crew) + 'tampered' } }, check: async (response) => {
    assert.deepEqual(await response.json(), { role: null });
    assert.match(response.headers.get('cache-control'), /no-store/);
  } },
  { name: 'expired session', path: '/api/files?path=foreign/project/photos/private.jpg', init: {
    headers: { Cookie: cookie(crew, { now: Math.floor(Date.now() / 1000) - 60, ttlSeconds: 1 }) },
  }, check: async (response) => { assert.equal(response.status, 401); } },
  { name: 'revoked membership', path: '/api/files?path=foreign/project/photos/private.jpg', init: {
    headers: { Cookie: cookie({ ...crew, role: 'contractor', membershipId: 'revoked-local-test' }) },
  }, check: async (response) => { assert.equal(response.status, 404); } },
  { name: 'crew session isolation', path: '/api/session', init: { headers: { Cookie: cookie(crew) } }, check: async (response) => {
    assert.deepEqual(await response.json(), { role: 'field' });
    assert.match(response.headers.get('cache-control'), /no-store/);
  } },
  { name: 'homeowner session isolation', path: '/api/session', init: {
    headers: { Cookie: cookie({ role: 'client', name: 'Fixture homeowner', email: 'homeowner@example.test', contactId: 'contact-johnson' }) },
  }, check: async (response) => {
    assert.deepEqual(await response.json(), { role: 'client' });
    assert.match(response.headers.get('cache-control'), /no-store/);
  } },
  { name: 'crew update page', path: '/field/update', init: { headers: { Cookie: cookie(crew) } }, check: async (response) => {
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Submit to Project Manager/);
  } },
  { name: 'crew task page', path: '/field/tasks', init: { headers: { Cookie: cookie(crew) } }, check: async (response) => {
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Tasks/);
  } },
  { name: 'homeowner update page', path: '/portal/updates', init: {
    headers: { Cookie: cookie({ role: 'client', name: 'Fixture homeowner', email: 'homeowner@example.test', contactId: 'contact-johnson' }) },
  }, check: async (response) => {
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.doesNotMatch(html, /Internal field notes|Material Takeoff/);
  } },
];

const jobs = Array.from({ length: cases.length * 80 }, (_, index) => cases[index % cases.length]);
let next = 0;
const durations = [];
const statuses = {};
const start = performance.now();
await Promise.all(Array.from({ length: 16 }, async () => {
  while (next < jobs.length) {
    const job = jobs[next++];
    const began = performance.now();
    const response = await fetch(new URL(job.path, base), {
      ...job.init, redirect: 'manual', signal: AbortSignal.timeout(15_000),
    });
    await job.check(response);
    await response.arrayBuffer().catch(() => {});
    statuses[response.status] = (statuses[response.status] || 0) + 1;
    durations.push(performance.now() - began);
  }
}));
durations.sort((a, b) => a - b);
const report = {
  scope: 'Isolated local production build; synthetic identities; no live service credentials.',
  requests: jobs.length, concurrency: 16, passed: durations.length,
  elapsedMs: Math.round(performance.now() - start),
  p95Ms: Math.round(durations[Math.floor(durations.length * 0.95)]), statuses,
  cases: cases.map((item) => item.name),
  limitation: 'Not a Vercel capacity benchmark, a live SSO test, or a real crew-to-homeowner workflow.',
};
await mkdir(new URL('../.artifacts/', import.meta.url), { recursive: true });
await writeFile(new URL('../.artifacts/pilot-stress.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
