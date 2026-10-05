import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssDirectory = path.join(repo, 'apps/web/.next/static/css');
const cssFiles = (await readdir(cssDirectory)).filter(name => name.endsWith('.css'));
assert.ok(cssFiles.length > 0, 'Run the production build before this visual test.');
const css = (await Promise.all(cssFiles.map(name => readFile(path.join(cssDirectory, name), 'utf8')))).join('\n');
const mocks = {
  'next/link': 'export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>;}',
  'next/navigation': "export function notFound(){throw Error('NOT_FOUND');}",
  '@/lib/scope': "export async function requireTenantScope(){return {contractorId:'tenant1',locationId:'location1',authProfileIds:['profile1']};}",
  '@/lib/data/current-source': `export async function currentDataSource(){return {
    getProject:async()=>({provenance:'buildsuite',buildsuiteProjectId:'p1',projectName:'Pilot',clientName:'Test client',projectAddress:'Test address',currentMilestone:'',nextMilestone:'',budgetBand:'$10k-$20k',clientPortalEnabled:false,showBudgetToClient:false,showDetailedPricing:false,showScheduleToClient:false,showAssignedTeam:false,projectManager:'Test PM',superintendent:''}),
    listMilestones:async()=>[],listDailyUpdates:async()=>[],listTasks:async()=>[]
  };}`,
  '@/components/project-editor': 'export function ProjectEditor(){return null;}',
  '@/lib/hub-db/records': 'export function getHubRecords(){return {available:false};}',
  '@/lib/hub-db/team': "export function getHubTeam(){return {available:true,team:{listTeam:async()=>{throw Error('Simulated team outage');}}};}",
  '@/lib/buildsuite/proposals': "export function pickCurrentProposal(){return null;} export function getProposalsReader(){return {available:true,listForProjects:async()=>{throw Error('Simulated proposal outage');}};}",
};
const bundle = await build({
  absWorkingDir: path.join(repo, 'apps/web'),
  stdin: {
    contents: `import {createRoot} from 'react-dom/client'; import Page from './src/app/dashboard/projects/[id]/page';
      Page({params:Promise.resolve({id:'p1'})}).then(content=>createRoot(document.getElementById('root')).render(content));`,
    resolveDir: path.join(repo, 'apps/web'),
    loader: 'tsx',
  },
  bundle: true, write: false, jsx: 'automatic', format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'overview-read-fixtures', setup(build) {
    build.onResolve({ filter: /.*/ }, args => mocks[args.path] === undefined ? undefined : { path: args.path, namespace: 'overview-fixture' });
    build.onLoad({ filter: /.*/, namespace: 'overview-fixture' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: path.join(repo, 'apps/web') }));
  } }],
});
const server = createServer((request, response) => {
  if (request.url === '/bundle.js') {
    response.setHeader('Content-Type', 'application/javascript');
    response.end(bundle.outputFiles[0].contents);
  } else if (request.url === '/app.css') {
    response.setHeader('Content-Type', 'text/css');
    response.end(css);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><main class="mx-auto max-w-6xl p-5"><div id="root"></div></main><script src="/bundle.js"></script>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mkdir(path.join(repo, '.artifacts'), { recursive: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('status').filter({ hasText: 'Project access could not be loaded' }).waitFor();
    assert.equal(await page.getByRole('status').count(), 2);
    assert.ok(await page.getByText('Contract details could not be loaded. Refresh to try again.', { exact: true }).isVisible());
    assert.equal(await page.getByText('Nobody has been invited to this project yet.', { exact: false }).count(), 0);
    assert.equal(await page.getByText('$10k-$20k', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.getByRole('status').evaluateAll(elements => elements.some(element => element.scrollWidth > element.clientWidth)), false);
    await page.screenshot({ path: path.join(repo, '.artifacts', `overview-unavailable-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: actual Overview JSX and application CSS show truthful optional-read failures at 390/1440px without overflow. Reads/editor are isolated fixtures; this is not a live product screenshot.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
