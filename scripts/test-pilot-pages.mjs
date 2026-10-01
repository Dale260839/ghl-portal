import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { sign } from '../apps/web/src/lib/auth/session-crypto.ts';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.PILOT_TEST_URL || 'http://127.0.0.1:3107';
const secret = process.env.PILOT_TEST_SECRET;
if (!secret || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) {
  throw new Error('Local-only smoke test: supply the isolated test server secret.');
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const artifacts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.artifacts');
await mkdir(artifacts, { recursive: true });
try {
  const context = await browser.newContext();
  const refused = await context.request.get(base + '/api/auth/ghl?json=1&locationId=IyKL37e3QdiFBx5ESI2d');
  assert.equal((await refused.json()).ok, false, 'an API credential must not enable unsigned login');
  assert.equal(refused.headers()['set-cookie'], undefined);
  const forged = await context.request.post(base + '/api/auth/ghl?json=1', {
    headers: { Origin: 'https://untrusted.example' }, data: { encryptedData: '{}' },
  });
  assert.equal(forged.status(), 403);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const staff = {
    role: 'field', name: 'Local pilot crew', email: 'crew@example.test',
    authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40'],
    ghlLocationId: 'loc_alliance_pro', ghlUserId: 'local-only', ghlIdentityVerified: true,
  };
  const cookie = (payload) => ({
    name: 'bs_session_hub', value: sign(payload, secret, { ttlSeconds: 300 }),
    url: base, httpOnly: true, sameSite: 'Lax',
  });
  await context.addCookies([cookie(staff)]);
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto(base + '/field/update');
    await page.getByRole('heading', { name: 'Add daily update', level: 1 }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Submit to Project Manager' }).isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: path.join(artifacts, 'pilot-field-' + viewport.width + '.png'), fullPage: true });
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();

  await context.addCookies([cookie({
    role: 'client', name: 'Local homeowner', email: 'homeowner@example.test', contactId: 'contact-johnson',
  })]);
  await page.goto(base + '/portal/updates');
  assert.equal(await page.getByText('Internal field notes', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Material Takeoff', { exact: true }).count(), 0);
  await page.screenshot({ path: path.join(artifacts, 'pilot-homeowner.png'), fullPage: true });

  await context.addCookies([cookie({ ...staff, role: 'contractor', membershipId: 'revoked-local-test' })]);
  const revoked = await context.request.get(base + '/api/files?path=c1/p1/documents/private.pdf');
  assert.equal(revoked.status(), 404, 'a revoked invited contractor cannot keep serving raw paths');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS: unsigned login and forged origin refused; revoked file access denied; field mobile/desktop and homeowner pages render; sign-out works.');
} finally {
  await browser.close();
}
