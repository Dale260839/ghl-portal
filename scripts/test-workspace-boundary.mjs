import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Boot the built app with an intentionally invalid test secret. getSession in
// dashboard/layout throws before any tenant/database lookup can happen.
const child = spawn(process.execPath, ['--input-type=module', '-e', `
  import next from 'next';
  import {createServer} from 'node:http';
  const app = next({dev:false,dir:process.cwd(),hostname:'127.0.0.1'});
  await app.prepare();
  const server = createServer(app.getRequestHandler());
  server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
`], {
  cwd: path.join(repo, 'apps/web'),
  env: { PATH: process.env.PATH, HOME: process.env.HOME, SystemRoot: process.env.SystemRoot,
    NODE_ENV: 'production', SESSION_SECRET: 'invalid-fixture', NEXT_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
let logs = '';
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });
let browser;
let timer;
try {
  const port = await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Fixture boot timed out: ${logs}`)), 30_000);
    child.once('message', message => { clearTimeout(timer); resolve(message.port); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Fixture exited ${code}: ${logs}`)));
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${port}`;
  const external = [];
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) {
      external.push(route.request().url()); return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${origin}/dashboard`);
  await page.getByText('This workspace could not be loaded or saved just now.', { exact: false }).waitFor();
  assert.ok(await page.getByText(/^Reference \d+$/).isVisible());
  assert.equal(await page.getByText('You are signed out in this browser.', { exact: true }).count(), 0);
  assert.equal(await page.getByText('SESSION_SECRET', { exact: false }).count(), 0);
  assert.match(logs, /SESSION_SECRET is missing or too short/, 'the controlled server failure actually occurred');
  await mkdir(path.join(repo, '.artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(repo, '.artifacts', 'production-layout-recovery.png'), fullPage: true });
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Reload page' }).click()]);
  await page.getByText('This workspace could not be loaded or saved just now.', { exact: false }).waitFor();
  const getLogout = await page.request.get(`${origin}/api/auth/sign-out`);
  assert.equal(getLogout.status(), 405);
  const crossSiteLogout = await page.request.post(`${origin}/api/auth/sign-out`, {
    headers: { origin: 'https://outside.invalid' },
  });
  assert.equal(crossSiteLogout.status(), 403);
  assert.equal(crossSiteLogout.headers()['set-cookie'], undefined);
  assert.deepEqual(external, []);
  console.log('PASS: the built Next app catches a real dashboard-layout exception in the root recovery screen, hides server details, survives reload, and rejects GET/cross-site sign-out. No live credentials or data used.');
} finally {
  clearTimeout(timer);
  await browser?.close();
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); child.kill(); await exited;
  }
}
