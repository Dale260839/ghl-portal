/**
 * No raw ID on any screen — checked by rendering every screen.
 *
 *   npm run build && npm start          (in apps/web, in one terminal)
 *   npm run check:ids                   (from the repo root, in another)
 *
 * John, 2026-09-12: "make sure not display any project id that is random
 * strings". The guardrail in `guardrails.test.ts` refuses the three shapes the
 * code has used; this is the check that does not depend on knowing the shapes.
 * It renders all 130 routes as a contractor, a crew member and a homeowner —
 * and every project tab as a client preview — and scans what a person can
 * actually SEE: page text, tooltips, placeholders, alt text and labels. Script
 * payloads and link targets are excluded; nobody reads those.
 *
 * Exits non-zero when anything is found. Proven not to be vacuous on the day it
 * was written: with a UUID planted back in the project header it flagged all
 * 42 project tabs that share that header.
 *
 * Uses the live projects named below and mints sessions with the local
 * SESSION_SECRET, so it runs against a local build, never against production.
 */
process.loadEnvFile('.env.local');
const { sign, resolveSessionSecret } = await import('../src/lib/auth/session-crypto.ts');

const BASE = process.argv[2] ?? 'http://localhost:3466';
const secret = resolveSessionSecret();
const mint = (s: object) => sign(s, secret, { ttlSeconds: 3600 });

const APS = ['81daa865-5441-48e2-a159-23c5fa3c58fe'];
const sessions = {
  'contractor (APS)': mint({ role: 'contractor', name: 'Alliance Pro Services', email: 'aps@example.com', authProfileIds: APS }),
  'contractor (Ralph)': mint({ role: 'contractor', name: 'Marcus Reyes', email: 'marcus@allianceproservices.com', authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40'] }),
  'field (demo crew)': mint({ role: 'field', name: 'Tony Alvarez', email: 'tony@allianceproservices.com', authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40'] }),
  'client (demo)': mint({ role: 'client', name: 'Dana Johnson', email: 'dana@example.com', contactId: 'contact-johnson' }),
};

const PROJECTS = {
  'BSA-053': '75233730-d76f-41d7-a495-d40cb7a9c912',
  'BSA-APS-001': 'bbd77380-ebc6-417f-8aaf-0f03150198dc',
  'BSA-052': '39089861-15bb-467f-a169-8dfc88778671',
};
const SUB = ['', '/budget', '/change-orders', '/completion', '/designs', '/documents', '/issues', '/messages', '/payments', '/photos', '/schedule', '/timeline', '/updates', '/visibility'];
const PORTAL = ['', '/budget', '/change-orders', '/completion', '/designs', '/documents', '/issues', '/messages', '/payments', '/photos', '/schedule', '/timeline', '/updates'];

const routes: [keyof typeof sessions, string][] = [];
for (const who of ['contractor (APS)', 'contractor (Ralph)'] as const) {
  for (const r of ['/dashboard', '/dashboard/archive', '/dashboard/buildsuite', '/dashboard/engagements', '/dashboard/invoices', '/dashboard/invoices/sample', '/dashboard/invoices/template', '/dashboard/issues', '/dashboard/pipeline', '/dashboard/projects', '/dashboard/projects?view=all', '/dashboard/projects?view=draft', '/dashboard/team', '/dashboard/updates']) routes.push([who, r]);
}
for (const [code, id] of Object.entries(PROJECTS)) {
  const who = code === 'BSA-052' ? 'contractor (Ralph)' : 'contractor (APS)';
  for (const s of SUB) routes.push([who, `/dashboard/projects/${id}${s}`]);
  for (const s of PORTAL) routes.push([who, `/portal${s}?preview=${id}`]);
}
for (const r of ['/field', '/field/documents', '/field/issues', '/field/messages', '/field/photos', '/field/punch', '/field/tasks', '/field/update']) routes.push(['field (demo crew)', r]);
for (const s of PORTAL) routes.push(['client (demo)', `/portal${s}`]);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// A truncated UUID: the first 8 hex chars of a project id shown on its own.
const PREFIXES = Object.values(PROJECTS).map((id) => id.slice(0, 8));

function visibleText(html: string): string {
  // Scripts carry the React payload — full of ids, none of it rendered text.
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // Attributes a person can see or hear: tooltips, placeholders, alt text, labels.
  const attrs = [...body.matchAll(/\s(?:title|placeholder|alt|aria-label)="([^"]*)"/gi)].map((m) => m[1]);
  const text = body.replace(/<[^>]+>/g, ' ');
  return `${text} ${attrs.join(' ')}`.replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
}

let findings = 0;
let pages = 0;
const statuses = new Map<number, number>();
for (const [who, route] of routes) {
  let res: Response;
  try {
    res = await fetch(BASE + route, { headers: { cookie: `bs_session_hub=${sessions[who]}` }, redirect: 'manual' });
  } catch (e) {
    console.log(`  FETCH FAILED ${route}: ${(e as Error).message}`);
    continue;
  }
  statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
  if (res.status !== 200) {
    console.log(`  ${res.status} ${who.padEnd(20)} ${route}${res.headers.get('location') ? ' -> ' + res.headers.get('location') : ''}`);
    continue;
  }
  pages += 1;
  const text = visibleText(await res.text());
  const full = [...new Set(text.match(UUID) ?? [])];
  const partial = PREFIXES.filter((pre) => new RegExp(`(^|[^0-9a-f-])${pre}([^0-9a-f-]|$)`, 'i').test(text));
  if (full.length > 0 || partial.length > 0) {
    findings += 1;
    console.log(`  ID ON SCREEN  ${who.padEnd(20)} ${route}`);
    for (const id of full) {
      const i = text.indexOf(id);
      console.log(`       ${id}   …${text.slice(Math.max(0, i - 50), i).replace(/\s+/g, ' ').trim()} [ID] ${text.slice(i + 36, i + 70).replace(/\s+/g, ' ').trim()}…`);
    }
    for (const pre of partial) console.log(`       truncated id ${pre}`);
  }
}
console.log(`\n${pages} pages rendered (${[...statuses].map(([s, n]) => `${s}×${n}`).join(', ')}), ${findings} with a raw id on screen`);
// Nothing rendered is a failure too — a check that reached no page proved nothing.
if (findings > 0 || pages === 0) process.exit(1);
