import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { sign } from '../apps/web/src/lib/auth/session-crypto.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(repo, 'apps/web');
for (const folder of [repo, web]) for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  try { await access(path.join(folder, name)); throw new Error('Refusing to test a build that can load real credentials.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const secret = 'synthetic-built-cleanup-secret-'.repeat(3);
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', SESSION_SECRET: secret };
const next = spawn(process.execPath, [path.join(repo, 'node_modules/next/dist/bin/next'), 'start', '-H', 'localhost', '-p', '3113'], { cwd: web, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; next.stdout.on('data', chunk => { logs += chunk; }); next.stderr.on('data', chunk => { logs += chunk; });
const origin = 'http://localhost:3113';
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (next.exitCode !== null) throw new Error(logs);
    try { const response = await fetch(origin); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, logs);
  const smoke = spawn(process.execPath, ['scripts/test-pilot-pages.mjs'], { cwd: repo,
    env: { ...env, PILOT_TEST_URL: origin, PILOT_TEST_SECRET: secret, PLAYWRIGHT_CHROMIUM_EXECUTABLE: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }, stdio: 'inherit' });
  assert.equal(await new Promise(resolve => smoke.on('exit', resolve)), 0);
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const cookie = payload => ({ name: 'bs_session_hub', value: sign(payload, secret, { ttlSeconds: 300 }), url: origin, httpOnly: true, sameSite: 'Lax' });
  const manager = { role: 'contractor', name: 'Synthetic manager', email: 'manager@example.test', ghlUserId: 'fixture-manager',
    ghlLocationId: 'loc_alliance_pro', authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40'], ghlIdentityVerified: true, ghlEmbedded: true };
  await context.addCookies([cookie(manager)]);
  await mkdir(path.join(repo, '.artifacts'), { recursive: true });
  for (const width of [320, 390, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto(origin + '/dashboard'); assert.equal(response.status(), 200);
    await page.getByRole('heading', { name: 'Portfolio Dashboard' }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Open Project Hub in a new tab' }).isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `actual built dashboard fits ${width}px`);
    await page.screenshot({ path: path.join(repo, '.artifacts', `built-dashboard-${width}.png`), fullPage: true });
  }
  await context.addCookies([cookie({ role: 'client', name: 'Synthetic homeowner', email: 'homeowner@example.test', contactId: 'contact-johnson' })]);
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto(origin + '/portal'); assert.equal(response.status(), 200);
  await page.getByText('Latest published update', { exact: true }).waitFor();
  assert.ok(await page.getByText('No upcoming dates have been shared for this project.', { exact: true }).isVisible());
  assert.equal(await page.getByRole('button', { name: 'Open Project Hub in a new tab' }).count(), 0);
  const latest = await page.locator('dl div').filter({ has: page.getByText('Latest published update', { exact: true }) }).locator('dd').innerText();
  assert.equal(latest, 'Aug 1, 2026');
  assert.equal(await page.getByText('Internal field notes', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(repo, '.artifacts', 'built-homeowner-dates-390.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS: production-built contractor dashboard at six widths; homeowner published date and expired schedule labels; original field/sign-out/isolation smoke. Local synthetic sessions only.');
} finally {
  await browser?.close(); next.kill('SIGTERM');
  await new Promise(resolve => { if (next.exitCode !== null) resolve(); else next.on('exit', resolve); });
  await mkdir(path.join(repo, '.artifacts'), { recursive: true });
  await writeFile(path.join(repo, '.artifacts', 'built-cleanup-server.log'), logs);
}
