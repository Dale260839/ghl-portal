/**
 * Capture tomorrow's 7am click path on PRODUCTION for the live HUD.
 *   node scripts/hud-live-shots.mjs
 * Signs in as the demo contractor persona (no credentials), walks each screen,
 * waits for streamed content to reveal (headless is a visible page, so rAF
 * fires), measures the hover target for the red cursor, and writes PNGs + meta.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'https://project-hub-one-vert.vercel.app';
const OUT = '/mnt/c/Users/Lenovo/AppData/Local/Temp/claude/C--Users-Lenovo-Desktop-chris/d74e63d9-71eb-4b56-b577-b68ff1fdeff9/scratchpad/shots2';
const PID = '39089861-15bb-467f-a169-8dfc88778671';
mkdirSync(OUT, { recursive: true });

const steps = [
  { name: 'signin', url: '/', target: 'text=Contractor Dashboard', beforeAuth: true },
  { name: 'dashboard', url: '/dashboard', target: 'text=Active Projects Overview' },
  { name: 'rowmenu', url: '/dashboard', click: 'button[aria-label="Project actions"]', target: '[role="menu"]' },
  { name: 'projects', url: '/dashboard/projects', target: 'a:has-text("[HUB TEST] Kitchen remodel")' },
  { name: 'workspace', url: `/dashboard/projects/${PID}`, target: 'main nav a:has-text("Change Orders")' },
  { name: 'schedule', url: `/dashboard/projects/${PID}/schedule`, target: 'button:has-text("New appointment")' },
  { name: 'changeorders', url: `/dashboard/projects/${PID}/change-orders`, target: 'button:has-text("New change order")' },
  { name: 'visibility', url: `/dashboard/projects/${PID}/visibility`, target: 'input[name="clientPortalEnabled"]' },
  { name: 'previewhome', url: `/portal?preview=${PID}`, target: 'main h1' },
  { name: 'previewschedule', url: `/portal/schedule?preview=${PID}`, target: 'text=Schedule not shared' },
  { name: 'previewchangeorders', url: `/portal/change-orders?preview=${PID}`, target: 'header a[href="/portal/change-orders"]' },
  { name: 'switch', url: '/dashboard', click: 'button:has-text("Viewing as")', target: 'text=Client Portal' },
  { name: 'team', url: '/dashboard/team', target: 'text=Invite someone' },
  { name: 'buildsuite', url: '/dashboard/buildsuite', target: 'main h1' },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const meta = {};

async function settle() {
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForSelector('[aria-label="Loading"]', { state: 'detached', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function shoot(step) {
  const t0 = Date.now();
  await page.goto(BASE + step.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await settle();
  if (step.click) {
    await page.locator(step.click).first().click({ timeout: 15_000 }).catch((e) => console.log('  click failed', step.click, String(e).slice(0, 80)));
    await page.waitForTimeout(400);
  }
  let cx = 50, cy = 50, ok = false;
  try {
    const loc = page.locator(step.target).first();
    await loc.waitFor({ state: 'visible', timeout: 20_000 });
    const box = await loc.boundingBox();
    if (box) { cx = Math.round(((box.x + box.width / 2) / 1440) * 1000) / 10; cy = Math.round(((box.y + box.height / 2) / 900) * 1000) / 10; ok = true; }
  } catch (e) { console.log('  target not found', step.target, String(e).slice(0, 60)); }
  await page.screenshot({ path: `${OUT}/${step.name}.png` });
  meta[step.name] = { cx, cy, ok, url: step.url, ms: Date.now() - t0 };
  console.log(`${step.name} ${ok ? 'ok' : 'FALLBACK'} cx=${cx} cy=${cy} ${Date.now() - t0}ms`);
}

// 1. The sign-in screen, before we are signed in.
await shoot(steps[0]);
// Sign in as the demo contractor persona: radio is preselected, submit.
await page.getByRole('button', { name: /^Sign in$/ }).click({ timeout: 15_000 });
await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
console.log('signed in');
for (const step of steps.slice(1)) await shoot(step);

writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 2));
await browser.close();
console.log('done', Object.keys(meta).length, 'shots');
