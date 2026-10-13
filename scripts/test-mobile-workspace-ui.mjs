import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(repo, 'apps/web');
const cssDir = path.join(web, '.next/static/css');
const css = (await Promise.all((await readdir(cssDir)).filter(f => f.endsWith('.css'))
  .map(f => readFile(path.join(cssDir, f), 'utf8')))).join('\n');
const fixtures = {
  'next/link': `export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>;} export const useLinkStatus=()=>({pending:false});`,
  'next/headers': `export const cookies=async()=>({get:()=>undefined});`,
  'next/navigation': `export const usePathname=()=>location.pathname; export const useSearchParams=()=>new URLSearchParams(location.search);`,
  '@/lib/actions': `export const switchAccount=async()=>{};export const viewAs=async()=>{};export const returnToMyAccount=async()=>{};`,
  '@/lib/view-as': `export const VIEW_AS_OPTIONS=[];`,
};
const bundle = await build({
  absWorkingDir: web, stdin: { resolveDir: web, loader: 'tsx', contents: `
    import {createRoot} from 'react-dom/client';
    import {AppShell} from './src/components/app-shell';
    import {OpenWorkspace} from './src/components/open-workspace';
    import {OpenWorkspaceLanding} from './src/app/auth/open-workspace/landing';
    import {AccountSwitcher} from './src/components/account-switcher';
    import {ViewSwitcher} from './src/components/view-switcher';
    void(async()=>{
      const root=createRoot(document.getElementById('root'));
      if(location.pathname==='/auth/open-workspace'){root.render(<OpenWorkspaceLanding/>);return;}
      root.render(await AppShell({brand:'APS',brandSuffix:'Project Hub',contextTitle:'Alliance Pro Services',
        contextSubtitle:'Local test manager',userName:'Local test manager',nav:[{href:'/dashboard',label:'Portfolio Dashboard'}],
        headerExtra:<><OpenWorkspace/><AccountSwitcher current='fixture' accounts={[{authProfileId:'fixture',businessName:'Alliance Pro Services',email:'manager@example.test',projectCount:1}]}/><ViewSwitcher current='contractor' viewing={false}/></>,
        children:<><h1 className='text-2xl font-semibold'>Portfolio Dashboard</h1><p>Local synthetic project</p></>}));
    })();
  ` }, bundle: true, write: false, jsx: 'automatic', format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'local-workspace-fixtures', setup(builder) {
    builder.onResolve({ filter: /^(next\/|@\/lib\/(actions|view-as)$)/ }, args =>
      fixtures[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], loader: 'jsx', resolveDir: web }));
  } }],
});
const tickets = new Set();
const requests = [];
let scenario = 'success';
let issued = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].contents); return; }
  if (url.pathname === '/app.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
  if (url.pathname === '/parent') {
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><iframe title="Hub" src="/dashboard" style="width:100%;height:95vh;border:0"></iframe>'); return;
  }
  if (url.pathname === '/api/auth/open-workspace') {
    let body = ''; for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    requests.push({ method: req.method, path: req.url, referer: req.headers.referer, data });
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    if (data.action === 'issue') {
      issued++;
      if (scenario === 'outage') { res.statusCode = 503; res.end(JSON.stringify({ error: 'Could not connect. Try again.' })); return; }
      const token = (issued.toString(36).padStart(43, 'a'));
      tickets.add(token); res.end(JSON.stringify({ token })); return;
    }
    if (!tickets.delete(data.token) || scenario === 'expired') {
      res.statusCode = 401; res.end(JSON.stringify({ error: 'This link expired. Open Project Hub from GoHighLevel again.' })); return;
    }
    res.setHeader('Set-Cookie', 'local_workspace=1; HttpOnly; SameSite=Lax; Path=/');
    res.end(JSON.stringify({ redirectTo: '/dashboard' })); return;
  }
  res.setHeader('Content-Type', 'text/html'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  const context = await browser.newContext();
  const errors = [];
  context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
  const page = await context.newPage();
  await mkdir(path.join(repo, '.artifacts'), { recursive: true });
  const button = page.getByRole('button', { name: 'Open Project Hub in a new tab', exact: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + '/dashboard');
    await button.waitFor();
    await page.screenshot({ path: path.join(repo, '.artifacts', `mobile-workspace-${width}.png`), fullPage: true });
    const overflow = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
      offenders: [...document.querySelectorAll('header *')].filter(e => e.getBoundingClientRect().right > innerWidth)
        .map(e => ({ tag: e.tagName, text: e.textContent, width: e.getBoundingClientRect().width })) }));
    assert.equal(overflow.overflow, false, `no overflow at ${width}: ${JSON.stringify(overflow.offenders)}`);
    const headerBoxes = await page.locator('header button').evaluateAll(elements => elements.map(e => {
      const r = e.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width };
    }));
    for (const box of headerBoxes) assert.ok(box.x >= 0 && box.right <= width && box.width > 0, JSON.stringify({ width, box }));
    await page.screenshot({ path: path.join(repo, '.artifacts', `mobile-workspace-${width}.png`), fullPage: true });
    const popupEvent = context.waitForEvent('page'); await button.click(); const popup = await popupEvent;
    await popup.waitForURL(origin + '/dashboard');
    assert.equal(await popup.evaluate(() => opener === null), true);
    assert.equal(new URL(popup.url()).hash, '');
    await popup.close();
    await page.getByRole('button', { name: /Signed in as/ }).click();
    await page.getByPlaceholder('Filter by company or email').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `account menu fits at ${width}`);
    await page.keyboard.press('Escape');
  }
  await page.goto(origin + '/parent');
  const embedded = page.frameLocator('iframe');
  await embedded.getByRole('button', { name: 'Open Project Hub in a new tab' }).waitFor();
  const popupEvent = context.waitForEvent('page');
  await embedded.getByRole('button', { name: 'Open Project Hub in a new tab' }).click();
  const popup = await popupEvent; await popup.waitForURL(origin + '/dashboard');
  assert.equal(await popup.evaluate(() => opener === null), true); await popup.close();

  const redeemed = requests.find(r => r.data.action === 'redeem').data.token;
  await page.goto(origin + '/auth/open-workspace#' + redeemed);
  await page.getByRole('alert').waitFor(); assert.equal(new URL(page.url()).hash, '');
  const before = requests.length;
  await page.goto(origin + '/auth/open-workspace#malformed');
  await page.getByRole('alert').waitFor(); assert.equal(requests.length, before);
  scenario = 'outage'; await page.goto(origin + '/dashboard');
  await button.click(); await page.getByRole('alert').waitFor();
  assert.ok(await page.getByRole('alert').getByText('Could not connect. Try again.').isVisible());
  scenario = 'expired'; await page.goto(origin + '/dashboard');
  const expiredEvent = context.waitForEvent('page'); await button.click(); const expired = await expiredEvent;
  await expired.getByRole('alert').waitFor(); assert.equal(new URL(expired.url()).hash, '');
  await expired.close();
  const blockedContext = await browser.newContext();
  await blockedContext.addInitScript(() => { window.open = () => null; });
  const blocked = await blockedContext.newPage(); await blocked.goto(origin + '/dashboard');
  const issuedBefore = issued;
  await blocked.getByRole('button', { name: 'Open Project Hub in a new tab' }).click();
  await blocked.getByText('Allow a new tab, then try again.').waitFor(); assert.equal(issued, issuedBefore);
  for (const request of requests) {
    assert.equal(request.method, 'POST'); assert.equal(request.path, '/api/auth/open-workspace');
    assert.ok(!request.referer || !request.referer.includes('#'));
  }
  assert.deepEqual(errors, []);
  await blockedContext.close(); await context.close();
  console.log('PASS: actual shell/control components fit 320/390/768/1440px; embedded new-tab handoff, null opener, stripped fragment, replay/expiry/outage/blocked-popup recovery. Synthetic local API fixture only.');
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
