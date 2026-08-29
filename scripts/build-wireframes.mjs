/**
 * Generates `apps/web/src/lib/hud/wireframes.ts` from the RUNNING app.
 *
 *   npm run dev            # in another terminal
 *   node scripts/build-wireframes.mjs
 *
 * The first version of these maps was drawn from memory and was wrong in ways
 * that matter when someone is following them live: the client portal was drawn
 * with eleven nav items when it has thirteen, so "the eighth item" pointed at
 * the wrong row. Anything hand-drawn drifts the moment a screen changes.
 *
 * So the maps are scraped instead. Nav labels, their order, section headings and
 * button labels all come out of the real HTML. Vertical order follows the DOM,
 * which is also the order a person reads the page in.
 *
 * It needs two signed cookies to reach the authenticated screens — see
 * `scripts/mint-cookies.mjs`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '..');
const OUT = resolve(REPO, 'apps/web/src/lib/hud/wireframes.ts');
const BASE = process.env.HUD_BASE_URL ?? 'http://localhost:3000';

const cookies = JSON.parse(readFileSync(resolve(REPO, '.hud-cookies.json'), 'utf8'));

/** Which screens the HUD can point at, and who has to be signed in to see them. */
const PAGES = [
  { id: 'signin', name: 'Sign in', path: '/', as: null },
  { id: 'dashboard', name: 'Contractor Dashboard', path: '/dashboard', as: 'staff' },
  { id: 'pipeline', name: 'Pipeline', path: '/dashboard/pipeline', as: 'staff' },
  { id: 'projects', name: 'Projects', path: '/dashboard/projects', as: 'staff' },
  {
    id: 'project',
    name: 'Project detail',
    path: '/dashboard/projects/:id',
    as: 'staff',
    route: '/dashboard/projects/...',
  },
  {
    id: 'visibility',
    name: 'Client Visibility Settings',
    path: '/dashboard/projects/:id/visibility',
    as: 'staff',
    route: '/dashboard/projects/.../visibility',
  },
  { id: 'updates', name: 'Field Updates', path: '/dashboard/updates', as: 'staff' },
  { id: 'buildsuite', name: 'Incoming from BuildSuite', path: '/dashboard/buildsuite', as: 'staff' },
  { id: 'portal', name: 'Client Portal — Dashboard', path: '/portal', as: 'client' },
  { id: 'portalTimeline', name: 'Project Timeline', path: '/portal/timeline', as: 'client' },
  { id: 'portalUpdates', name: 'Daily Updates', path: '/portal/updates', as: 'client' },
  { id: 'portalDocuments', name: 'Document Center', path: '/portal/documents', as: 'client' },
  { id: 'portalPhotos', name: 'Photos & Videos', path: '/portal/photos', as: 'client' },
  { id: 'portalDesigns', name: 'Designs & Selections', path: '/portal/designs', as: 'client' },
  { id: 'field', name: 'Field Interface', path: '/field', as: 'staff' },
];

/**
 * Links that are navigation rather than content.
 *
 * The one hand-maintained list left in a script whose whole purpose is that
 * hand-maintained lists go stale — and it duly did: `/dashboard/pipeline` shipped
 * and every wireframe silently lost a nav item, which is exactly the class of
 * error this file was written to stop. `warnUnlistedNavHrefs` below now makes
 * that loud instead of silent.
 */
const NAV_HREFS = new Set([
  '/dashboard',
  '/dashboard/pipeline',
  '/dashboard/projects',
  '/dashboard/updates',
  '/dashboard/issues',
  '/dashboard/buildsuite',
  '/portal',
  '/portal/timeline',
  '/portal/schedule',
  '/portal/updates',
  '/portal/designs',
  '/portal/budget',
  '/portal/change-orders',
  '/portal/documents',
  '/portal/photos',
  '/portal/messages',
  '/portal/issues',
  '/portal/payments',
  '/portal/completion',
]);

/** Chrome the presenter is never told to hover. */
const SKIP_BUTTONS = new Set(['Sign out', 'Back to my account']);

function decode(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(s) {
  return decode(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);
}

async function fetchPage(path, as) {
  const headers = {};
  if (as !== null) headers.Cookie = `bs_session_hub=${cookies[as]}`;
  const res = await fetch(BASE + path, { headers, redirect: 'manual' });
  if (res.status !== 200) throw new Error(`${path} returned ${res.status} — is the session valid?`);
  return await res.text();
}

/**
 * Shout when a top-level app link is not on NAV_HREFS.
 *
 * A missing entry does not fail anything — it just quietly drops the item from
 * every map, and the HUD then points a presenter at the wrong row. Better to say
 * so on every run than to discover it during a demo.
 */
function warnUnlistedNavHrefs(html, navCount) {
  const unlisted = new Set();
  for (const m of html.matchAll(/<a[^>]*href="(\/(?:dashboard|portal|field)[^"]*)"/g)) {
    const href = m[1];
    // Detail routes are content, not nav — two segments deep or more.
    if (href.split('/').filter(Boolean).length > 2) continue;
    if (!NAV_HREFS.has(href)) unlisted.add(href);
  }
  if (unlisted.size > 0) {
    console.warn(
      `  ! ${[...unlisted].join(', ')} look like nav but are not in NAV_HREFS ` +
        `— ${navCount} item(s) captured. Add them or the maps will be wrong.`,
    );
  }
}

function parse(html) {
  // Nav, in order, de-duplicated (desktop sidebar and mobile bar both render).
  const nav = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const href = m[1];
    if (!NAV_HREFS.has(href) || seen.has(href)) continue;
    // Strip a trailing badge count off the label — "Field Updates 2".
    const label = decode(m[2]).replace(/\s+\d+$/, '');
    if (label === '') continue;
    seen.add(href);
    nav.push({ href, label });
  }

  warnUnlistedNavHrefs(html, nav.length);

  const headings = [];
  for (const m of html.matchAll(/<(h1|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const t = decode(m[2]);
    if (t !== '' && t.length < 60) headings.push({ tag: m[1], text: t });
  }

  const buttons = [];
  for (const m of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
    const t = decode(m[1]);
    if (t === '' || t.length > 40) continue;
    if (SKIP_BUTTONS.has(t) || t.startsWith('Viewing as')) continue;
    if (!buttons.includes(t)) buttons.push(t);
  }

  return { nav, headings, buttons };
}

/**
 * Lays a page out on a 12-column grid.
 *
 * Nav down the left in real order; the page title, then each section, then the
 * action buttons in a row. Crude by design — it has to be recognisable at a
 * glance from a second monitor, not accurate to the pixel.
 */
function layout({ nav, headings, buttons }, hasSidebar) {
  const blocks = [];
  let row = 1;

  blocks.push({ id: 'banner', label: 'data banner', kind: 'header', col: [1, 12], row: [1, 1] });
  row = 2;

  const navRows = nav.length;
  const contentTop = 3;

  if (hasSidebar) {
    blocks.push({ id: 'context', label: 'project name', kind: 'header', col: [4, 6], row: [2, 1] });
    blocks.push({ id: 'switcher', label: 'Viewing as', kind: 'button', col: [10, 3], row: [2, 1] });
    nav.forEach((n, i) => {
      blocks.push({
        id: `nav-${slug(n.label)}`,
        label: n.label,
        kind: 'nav',
        col: [1, 3],
        row: [contentTop + i, 1],
      });
    });
  } else {
    blocks.push({ id: 'context', label: 'header', kind: 'header', col: [4, 6], row: [2, 1] });
  }

  const left = hasSidebar ? 4 : 4;
  const width = hasSidebar ? 9 : 6;

  const [title, ...sections] = headings;
  let r = contentTop;
  if (title !== undefined) {
    blocks.push({
      id: 'title',
      label: title.text,
      kind: 'header',
      col: [left, width],
      row: [r, 1],
    });
    r += 1;
  }

  for (const s of sections) {
    blocks.push({
      id: `sec-${slug(s.text)}`,
      label: s.text,
      kind: 'panel',
      col: [left, width],
      row: [r, 2],
    });
    r += 2;
  }

  if (buttons.length > 0) {
    const span = Math.max(2, Math.floor(width / Math.min(buttons.length, 4)));
    buttons.slice(0, 4).forEach((b, i) => {
      blocks.push({
        id: `btn-${slug(b)}`,
        label: b,
        kind: 'button',
        col: [left + i * span, span],
        row: [r, 1],
      });
    });
    r += 1;
  }

  const rows = Math.max(r, navRows + contentTop, 14);
  if (hasSidebar) {
    blocks.unshift({ id: 'sidebar', kind: 'sidebar', col: [1, 3], row: [2, rows - 1] });
  }
  return { blocks, rows };
}

// ── Diagrams: not scraped, because they are not screens ─────────────────────
const DIAGRAMS = `
  // Not screens — the map slot is the only drawing surface the HUD has, and an
  // architecture question is far easier to answer with a shape on it.
  systems: {
    name: 'How the three systems fit',
    route: 'GoHighLevel -> BuildSuite -> back at signing -> Project Hub',
    rows: 14,
    blocks: [
      { id: 'ghl', label: 'GoHighLevel — leads, CRM', kind: 'panel', col: [1, 4], row: [2, 3] },
      { id: 'buildsuite', label: 'BuildSuite — estimating', kind: 'panel', col: [5, 4], row: [2, 3] },
      { id: 'hub', label: 'Project Hub', kind: 'button', col: [9, 4], row: [2, 3] },
      { id: 'inbound', label: 'leads in, deals get bid', kind: 'row', col: [1, 8], row: [6, 1] },
      { id: 'handoff', label: 'hands back at signing', kind: 'row', col: [3, 9], row: [7, 1] },
      { id: 'syncback', label: 'stage sync-back, read-only', kind: 'row', col: [5, 8], row: [8, 1] },
      { id: 'supabase', label: "Supabase — BuildSuite's", kind: 'panel', col: [1, 6], row: [10, 2] },
      { id: 'hubtables', label: 'hub_ tables — not yet created', kind: 'panel', col: [7, 6], row: [10, 2] },
      { id: 'browsers', label: 'Contractor    Field    Client', kind: 'sidebar', col: [1, 12], row: [13, 2] },
    ],
  },

  stack: {
    name: 'What sits between a client and the data',
    route: 'screens -> the gate -> data layer -> sources',
    rows: 14,
    blocks: [
      { id: 'ui', label: 'Screens', kind: 'panel', col: [2, 10], row: [2, 2] },
      { id: 'gate', label: 'The gate: 4 checks, then strip internals', kind: 'button', col: [2, 10], row: [5, 3] },
      { id: 'data', label: 'Data layer — every staff read needs a tenant', kind: 'panel', col: [2, 10], row: [9, 2] },
      { id: 'src-1', label: 'Supabase', kind: 'row', col: [2, 5], row: [12, 2] },
      { id: 'src-2', label: 'GoHighLevel API', kind: 'row', col: [7, 5], row: [12, 2] },
    ],
  },
`;

// ── Run ─────────────────────────────────────────────────────────────────────

/**
 * `:id` is resolved from the live projects list rather than hardcoded.
 *
 * It used to be `BSP-2026-000184`, a fixture id, which worked only while the
 * session was the fixtures' invented profile. It is not, any more — the app
 * reads live BuildSuite — so the id is whatever this tenant actually has, and
 * asking the page beats guessing.
 */
const projectsHtml = await fetchPage('/dashboard/projects', 'staff');
// href= specifically: an unanchored match also finds Next.js chunk paths like
// /dashboard/projects/page.js, which are not projects.
const firstProjectId = (projectsHtml.match(/href="\/dashboard\/projects\/([^"/?#]+)"/) ?? [])[1];
if (firstProjectId === undefined) {
  throw new Error('no project link on /dashboard/projects — cannot scrape the detail screens');
}
console.log(`resolved :id      ${firstProjectId}`);

const screens = [];
for (const page of PAGES) {
  const html = await fetchPage(page.path.replace(':id', firstProjectId), page.as);
  const parsed = parse(html);
  const hasSidebar = parsed.nav.length > 0;
  const { blocks, rows } = layout(parsed, hasSidebar);
  screens.push({ page, blocks, rows, parsed });
  console.log(
    `${page.id.padEnd(17)} nav=${String(parsed.nav.length).padEnd(3)} sections=${String(
      Math.max(parsed.headings.length - 1, 0),
    ).padEnd(3)} buttons=${parsed.buttons.length}`,
  );
}

function emitBlock(b) {
  const label = b.label === undefined ? '' : `, label: ${JSON.stringify(b.label)}`;
  return `      { id: '${b.id}'${label}, kind: '${b.kind}', col: [${b.col[0]}, ${b.col[1]}], row: [${b.row[0]}, ${b.row[1]}] },`;
}

const body = screens
  .map(
    ({ page, blocks, rows }) => `  ${page.id}: {
    name: ${JSON.stringify(page.name)},
    route: ${JSON.stringify(page.route ?? page.path)},
    rows: ${rows},
    blocks: [
${blocks.map(emitBlock).join('\n')}
    ],
  },`,
  )
  .join('\n\n');

const file = `/**
 * Schematic maps of every screen the walkthrough visits.
 *
 * GENERATED — do not edit by hand. Run \`npm run hud:maps\` with the dev server
 * up, which scrapes the real pages so nav labels, their order, section headings
 * and button text come from the app rather than from anyone's memory. The
 * hand-drawn version of this file was wrong about the portal nav, the project
 * detail panels, and the number of buttons on the review screen.
 *
 * Vertical order follows the DOM, which is the order a person reads the page in.
 * Deliberately crude: it has to be recognisable at a glance from a second
 * monitor, not accurate to the pixel.
 *
 * The two entries at the bottom are diagrams rather than screens, so they are
 * authored in \`scripts/build-wireframes.mjs\` and not scraped.
 */

export type BlockKind = 'sidebar' | 'nav' | 'header' | 'tile' | 'panel' | 'row' | 'button' | 'hero';

export interface Block {
  id: string;
  label?: string;
  kind: BlockKind;
  /** [start column, span] on a 12-column grid. */
  col: [number, number];
  /** [start row, span]. */
  row: [number, number];
}

export interface Screen {
  name: string;
  /** Shown under the map — which page the presenter should be on. */
  route: string;
  /** How many grid rows this screen's blocks occupy. */
  rows: number;
  blocks: Block[];
}

export const SCREENS = {
${body}
${DIAGRAMS}} satisfies Record<string, Screen>;

export type ScreenId = keyof typeof SCREENS;
`;

writeFileSync(OUT, file, 'utf8');
console.log(`\nwrote ${OUT} — ${screens.length} scraped screens + 2 diagrams`);
