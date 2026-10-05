import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({
  absWorkingDir: path.join(repo, 'apps/web'), entryPoints: ['tests/ghl-ui-harness.tsx'],
  bundle: true, write: false, jsx: 'automatic', format: 'iife',
  plugins: [{
    name: 'test-router',
    setup(build) {
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'router', namespace: 'test' }));
      build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: "const router = { replace(to) { document.getElementById('redirect').textContent = to; } }; export const useRouter = () => router;",
      }));
    },
  }],
});
const requests = [];
const child = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/bundle.js') {
    res.setHeader('Content-Type', 'application/javascript');
    res.end(bundle.outputFiles[0].contents);
  } else if (url.pathname === '/api/auth/ghl') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, query: Object.fromEntries(url.searchParams), body: raw ? JSON.parse(raw) : null });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, redirectTo: '/dashboard' }));
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  }
});
await new Promise((resolve) => child.listen(0, '127.0.0.1', resolve));
const childOrigin = 'http://127.0.0.1:' + child.address().port;
let parentOrigin;
const parent = createServer((req, res) => {
  const scenario = new URL(req.url, 'http://localhost').searchParams.get('case') ?? 'valid';
  const signed = new URLSearchParams({ locationId: 'location-one', userId: 'user-one', timestamp: '12345', signature: 'signed-fixture' }).toString();
  const childQuery = new URLSearchParams({
    locationId: 'location-one', parentOrigin: scenario === 'untrusted' ? 'https://untrusted.invalid' : parentOrigin,
    signedQuery: scenario === 'signed' ? signed : 'locationId=location-one',
  });
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><output id="parent-requests">0</output>
    <iframe id="login" src="${childOrigin}/auth/ghl?${childQuery}" style="width:100%;height:650px"></iframe>
    <script>
      let count = 0;
      window.addEventListener('message', (event) => {
        if (event.origin !== ${JSON.stringify(childOrigin)} || event.source !== document.getElementById('login').contentWindow || event.data?.message !== 'REQUEST_USER_DATA') return;
        document.getElementById('parent-requests').textContent = String(++count);
        event.source.postMessage({ message: 'REQUEST_USER_DATA_RESPONSE', payload: ${scenario === 'malformed' ? '{}' : JSON.stringify('opaque-encrypted-context-fixture')} }, event.origin);
      });
    </script>`);
});
await new Promise((resolve) => parent.listen(0, '127.0.0.1', resolve));
parentOrigin = 'http://127.0.0.1:' + parent.address().port;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(parentOrigin);
  const frame = page.frameLocator('#login');
  await frame.locator('#redirect').getByText('/dashboard', { exact: true }).waitFor();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { method: 'POST', query: { json: '1' }, body: { encryptedData: 'opaque-encrypted-context-fixture', locationId: 'location-one' } });
  assert.equal(await page.locator('#parent-requests').innerText(), '1');

  requests.length = 0;
  await page.goto(parentOrigin + '?case=untrusted');
  await frame.getByRole('heading', { name: 'Open Project Hub inside the configured GoHighLevel custom page.' }).waitFor();
  assert.equal(requests.length, 0);
  assert.equal(await page.locator('#parent-requests').innerText(), '0');

  await page.goto(parentOrigin + '?case=malformed');
  await frame.getByRole('heading', { name: 'GoHighLevel did not respond. Reopen Project Hub from its custom page.' }).waitFor({ timeout: 15_000 });
  assert.equal(requests.length, 0);

  await page.goto(parentOrigin + '?case=signed');
  await frame.locator('#redirect').getByText('/dashboard', { exact: true }).waitFor();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { method: 'GET', query: { json: '1', locationId: 'location-one', userId: 'user-one', timestamp: '12345', signature: 'signed-fixture' }, body: null });
  assert.equal(await page.locator('#parent-requests').innerText(), '0');
  assert.deepEqual(errors, []);
  console.log('PASS: actual GHL connecting UI completes the iframe handshake, rejects untrusted origins/malformed context, and preserves signed identity fields. Backend responses are isolated fixtures, not a live GHL sign-in.');
} finally {
  await browser?.close();
  await new Promise((resolve) => parent.close(resolve));
  await new Promise((resolve) => child.close(resolve));
}
