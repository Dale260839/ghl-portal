/**
 * Replays a signed deal through the whole handoff chain and reports where it
 * stops.
 *
 *   node scripts/rehearse-handoff.mjs            # synthetic deal, no network
 *   node scripts/rehearse-handoff.mjs --live     # a real deal from BuildSuite
 *
 * Nothing has ever been signed — 0 of 182 — so the first real signature would
 * otherwise be spent debugging. This runs the sequence now.
 *
 * **It writes nothing, anywhere.** `--live` issues one read against BuildSuite
 * to pull a real deal and its project; every step after that is pure. There is
 * deliberately no flag that makes this perform the handoff.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = resolve(REPO, 'apps/web');

// pathToFileURL, not the bare path — Windows rejects `c:\...` as an ESM scheme.
const load = (relative) => import(pathToFileURL(resolve(WEB, relative)).href);

const { rehearseHandoff, formatRehearsal } = await load('src/lib/handoff/rehearsal.ts');
const { rehearseFullChain, formatFullChain } = await load('src/lib/handoff/full-chain.ts');
const { normalizeDeal } = await load('src/lib/buildsuite/deals.ts');

const live = process.argv.includes('--live');

/** A deal shaped like the real ones, signed. Used when not running --live. */
const SYNTHETIC = normalizeDeal({
  id: 'rehearsal-deal',
  status: 'proposal_sent',
  source: 'ghl_project_quote_survey',
  created_at: '2026-03-01T10:00:00Z',
  updated_at: '2026-08-20T10:00:00Z',
  auth_profile_id: 'rehearsal-profile',
  source_project_id: 'rehearsal-project',
  matched_contractor_id: 'rehearsal-contractor',
  sent_to_crm_at: null,
  signature_status: 'SIGNED',
  signature_signed_at: '2026-08-20T09:00:00Z',
  client_name: 'Chris Carr',
  project_type: 'kitchen',
  budget_range: '50k_100k',
  ghl_contact_id: null,
  ghl_opportunity_id: null,
  coverage_score: 0.9,
});

const SYNTHETIC_PROJECT = {
  id: 'rehearsal-project',
  projectCode: null,
  title: 'Kitchen remodel — Carr residence',
  address: '1 Example St, Bellevue, WA 98006',
  clientName: 'Chris Carr',
  clientEmail: 'chris@example.com',
  clientPhone: '555-0100',
  contractAmount: null,
};

async function liveSubject() {
  const env = readFileSync(resolve(WEB, '.env.local'), 'utf8');
  const read = (key) => (env.match(new RegExp(`^${key}=(.*)$`, 'm')) ?? [])[1]?.trim();
  const url = read('SUPABASE_URL');
  const key = read('SUPABASE_ANON_KEY');
  if (url === undefined || key === undefined) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY missing from apps/web/.env.local');
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (path) => {
    const response = await fetch(`${url}/rest/v1/${path}`, { headers });
    if (!response.ok) throw new Error(`BuildSuite read failed: ${response.status}`);
    return response.json();
  };

  const deals = await get('deals?select=*&source_project_id=not.is.null&limit=1');
  const deal = deals[0];
  if (deal === undefined) throw new Error('no deal carries a source_project_id');

  const [row] = await get(
    `projects?id=eq.${deal.source_project_id}&select=id,project_code,title,street_address,city,state,postal_code,client_name,client_email,client_phone,exact_budget`,
  );
  if (row === undefined) throw new Error(`deal points at project ${deal.source_project_id}, which is not readable`);

  return {
    deal: normalizeDeal(deal),
    project: {
      id: row.id,
      projectCode: row.project_code,
      title: row.title ?? '',
      address: [row.street_address, row.city, row.state, row.postal_code].filter(Boolean).join(', '),
      clientName: row.client_name ?? '',
      clientEmail: row.client_email,
      clientPhone: row.client_phone,
      contractAmount: typeof row.exact_budget === 'number' ? row.exact_budget : null,
    },
  };
}

const subject = live
  ? await liveSubject()
  : { deal: SYNTHETIC, project: SYNTHETIC_PROJECT };

const line = '─'.repeat(74);
console.log(line);
console.log(live ? 'HANDOFF REHEARSAL — a real deal from BuildSuite' : 'HANDOFF REHEARSAL — synthetic deal');
console.log(line);

console.log('\n▶ As it is today\n');
console.log(formatRehearsal(rehearseHandoff(subject)));

if (!subject.deal.signed && !subject.deal.sentToCrm) {
  console.log('\n▶ Same deal, if it were signed\n');
  console.log(formatRehearsal(rehearseHandoff({ ...subject, deal: { ...subject.deal, signed: true } })));
}

/** The same subject with every payload gap closed — what "once Sing ships it" looks like. */
const closed = {
  deal: { ...subject.deal, signed: true },
  project: {
    ...subject.project,
    projectCode: 'BSP-2026-000184',
    contractAmount: 82_500,
    clientEmail: subject.project.clientEmail ?? 'client@example.com',
    clientPhone: subject.project.clientPhone ?? '555-0100',
  },
  projectManagerUserId: 'user-pm-1',
};

console.log('\n▶ Signed, with every payload gap closed\n');
console.log(formatRehearsal(rehearseHandoff(closed)));

console.log(`\n${line}`);
console.log('THE WHOLE LOOP — handoff through to the homeowner seeing an update');
console.log(line);
console.log();
console.log(formatFullChain(rehearseFullChain(closed)));

console.log(`\n${line}`);
console.log('The blocked steps and who owns them: docs/HANDOFF-CONTRACT.md');
console.log(line);
