import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(repo, 'apps/web');
const cssDirectory = path.join(web, '.next/static/css');
const cssFiles = (await readdir(cssDirectory)).filter(name => name.endsWith('.css'));
assert.ok(cssFiles.length, 'Run the production build first.');
const css = (await Promise.all(cssFiles.map(name => readFile(path.join(cssDirectory, name), 'utf8')))).join('\n');
const bundle = await build({
  absWorkingDir: web,
  stdin: { resolveDir: web, loader: 'tsx', contents: `
    import {createRoot} from 'react-dom/client';
    import WorkspaceError from './src/app/error';
    import {FriendlyError} from './src/components/friendly-error';
    import {SignOutForm} from './src/components/sign-out-form';
    const scenario = new URLSearchParams(location.search).get('case');
    const props = {error:Object.assign(new Error('private server detail'),{digest:'fixture-742422397'}),
      reset:()=>document.getElementById('reset-count').textContent='1'};
    createRoot(document.getElementById('root')).render(scenario === 'logout'
      ? <SignOutForm><button type="submit">Sign out</button></SignOutForm>
      : scenario === 'other-role'
        ? <FriendlyError {...props} allowedRoles={['contractor']} backHref="/dashboard" backLabel="Back to dashboard" what="This screen"/>
        : <WorkspaceError {...props}/>);
  ` },
  bundle: true, write: false, jsx: 'automatic', format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'recovery-link-fixture', setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: 'export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>;}',
      loader: 'jsx', resolveDir: web,
    }));
  } }],
});
const posts = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/bundle.js') {
    res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].contents);
  } else if (url.pathname === '/app.css') {
    res.setHeader('Content-Type', 'text/css'); res.end(css);
  } else if (url.pathname === '/api/session') {
    const scenario = new URL(req.headers.referer).searchParams.get('case');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = scenario === 'unavailable' ? 503 : 200;
    res.end(JSON.stringify(scenario === 'invalid' ? {} : {
      role: scenario === 'signed-out' ? null : scenario === 'other-role' ? 'field' : 'contractor',
    }));
  } else if (url.pathname === '/api/auth/sign-out') {
    let body = ''; for await (const chunk of req) body += chunk;
    posts.push({ method: req.method, origin: req.headers.origin, action: req.headers['next-action'], body });
    res.writeHead(303, { Location: '/signed-out' }); res.end();
  } else if (url.pathname === '/signed-out') {
    res.end('Signed out fixture');
  } else if (url.pathname === '/parent') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><iframe title="Hub" src="/?case=logout"></iframe>');
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><output id="reset-count">0</output><script src="/bundle.js"></script>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mkdir(path.join(repo, '.artifacts'), { recursive: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await page.getByText('This workspace could not be loaded or saved just now.', { exact: false }).waitFor();
    assert.equal(await page.getByText('private server detail', { exact: false }).count(), 0);
    assert.ok(await page.getByText('Reference fixture-742422397').isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    assert.equal(await page.locator('#reset-count').innerText(), '1');
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Reload page' }).click()]);
    assert.equal(await page.locator('#reset-count').innerText(), '0');
    await page.getByText('This workspace could not be loaded or saved just now.', { exact: false }).waitFor();
    await page.screenshot({ path: path.join(repo, '.artifacts', `workspace-recovery-${width}.png`), fullPage: true });
  }
  for (const scenario of ['unavailable', 'invalid']) {
    await page.goto(`${origin}/?case=${scenario}`);
    await page.getByText('This workspace could not be loaded or saved just now.', { exact: false }).waitFor();
    assert.equal(await page.getByText('You are signed out in this browser.', { exact: true }).count(), 0);
  }
  await page.goto(`${origin}/?case=signed-out`);
  await page.getByText('You are signed out in this browser.', { exact: true }).waitFor();
  await page.goto(`${origin}/?case=other-role`);
  await page.getByText('This browser is signed in as someone else now.', { exact: true }).waitFor();

  for (const embedded of [false, true]) {
    await page.goto(embedded ? `${origin}/parent` : `${origin}/?case=logout`);
    const frame = embedded ? page.frameLocator('iframe') : page;
    await frame.getByRole('button', { name: 'Sign out' }).waitFor();
    await page.evaluate(() => {
      localStorage.setItem('bs_field_draft:update', 'legacy draft');
      localStorage.setItem('unrelated', 'keep');
      sessionStorage.setItem('bs_field_draft:test', 'private draft');
      sessionStorage.setItem('unrelated', 'keep');
    });
    await frame.getByRole('button', { name: 'Sign out' }).click();
    await frame.getByText('Signed out fixture').waitFor();
    assert.deepEqual(await page.evaluate(() => [
      localStorage.getItem('bs_field_draft:update'), sessionStorage.getItem('bs_field_draft:test'),
      localStorage.getItem('unrelated'), sessionStorage.getItem('unrelated'),
    ]), [null, null, 'keep', 'keep']);
  }
  assert.equal(posts.length, 2);
  for (const post of posts) assert.deepEqual(post, { method: 'POST', origin, action: undefined, body: '' });
  assert.deepEqual(errors, []);
  console.log('PASS: actual recovery components at 390/1440px, reset/reload, session-check failures, role mismatch, native top-level/iframe sign-out and draft cleanup. Isolated fixtures, no live systems accessed.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
