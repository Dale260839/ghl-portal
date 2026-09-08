/**
 * Screenshot the new contractor workspace + the client bell, signed in.
 *   node --experimental-strip-types scripts/shot.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { sign } from '../apps/web/src/lib/auth/session-crypto.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '..');
const env = readFileSync(resolve(REPO, 'apps/web/.env.local'), 'utf8');
const secret = env.match(/^SESSION_SECRET=(.*)$/m)[1].trim();
const TTL = 60 * 60 * 4;

// Marcus owns the Johnson fixture project (BSP-2026-000184).
const staff = sign(
  {
    role: 'contractor',
    name: 'Marcus Reyes',
    email: 'marcus@allianceproservices.com',
    authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40'],
    ghlLocationId: 'loc_alliance_pro',
  },
  secret,
  { ttlSeconds: TTL },
);
const client = sign(
  {
    role: 'client',
    name: 'Dana Johnson',
    email: 'dana@example.com',
    contactId: 'contact-johnson',
  },
  secret,
  { ttlSeconds: TTL },
);

const PID = 'BSP-2026-000184';
const shots = [
  ['staff', `/dashboard`, 'dash'],
  ['staff', `/dashboard/projects/${PID}`, 'ws-overview'],
  ['client', `/portal`, 'portal2'],
];

const cookieFor = (which) => ({
  name: 'bs_session_hub',
  value: which === 'client' ? client : staff,
  domain: 'localhost',
  path: '/',
});

const browser = await chromium.launch();
for (const [which, url, label] of shots) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([cookieFor(which)]);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:3000${url}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `/tmp/${label}.png`, fullPage: true });
  console.log(`${label} <- ${url} (${page.url()})`);
  await ctx.close();
}
await browser.close();
console.log('done');
