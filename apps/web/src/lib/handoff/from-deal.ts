import { validateHandoffPayload, type HandoffPayload } from '@buildsuite/contracts';

import type { Deal } from '../buildsuite/deals.ts';

/**
 * Building the §8.2 handoff payload out of a real BuildSuite deal.
 *
 * This is the mapping Sing has to implement inside Send-to-CRM, written here as
 * code so the gaps are facts rather than opinions. Nothing in this file calls
 * BuildSuite or GoHighLevel — it is the shape of the handoff, not the handoff.
 *
 * ---------------------------------------------------------------------------
 * WHAT BUILDING IT AGAINST REAL DATA REVEALED
 *
 * The contract in `packages/contracts/src/handoff.ts` is transcribed from
 * ARCHITECTURE §8.2 and it is **not satisfiable from `deals` today**. Three
 * gaps, measured 2026-08-28:
 *
 *  1. **`buildsuite_project_id` must match `BSP-YYYY-NNNNNN` (§5).** No such
 *     value exists anywhere in BuildSuite. `projects.id` is a UUID (101/101),
 *     and `projects.project_code` is `BSA-NNN` (48/101). Zero rows match the
 *     contracted pattern, so the handoff would reject **every** real project.
 *
 *     UPDATE 2026-09-03, from Sing: this is no longer an open question about
 *     *what* the key is, only about which side changes. C-3 is answered —
 *     BuildSuite generates it, GoHighLevel copies it, and the value is
 *     `project_code`. It has two shapes, `BSA-044` and `BSA-ASJF-006`, both
 *     allocated by a Postgres function at insert. Codes are permanent. So
 *     BuildSuite is not going to mint `BSP-YYYY-NNNNNN`, and **§5 is the side
 *     that has to move.** The blank half of the column is a *pending* state,
 *     not missing data.
 *
 *     The mapping below is deliberately NOT changed to match yet. Acting on
 *     this means editing §5, and §5 is a verbatim contract. `classifyProjectCode`
 *     encodes what Sing confirmed, tested, so the answer is available the moment
 *     Chris decides to move the contract — and until then the guard test still
 *     holds this file to reporting C-3 rather than resolving it.
 *
 *  2. **`contract_amount` must be a number.** BuildSuite holds `budget_range`,
 *     a band — `10k_25k`, `$50,000 - $100,000`. A band is not an amount and
 *     picking one end of it would put a wrong number on a contract.
 *
 *  3. **`client.email` and `client.phone` are required.** They exist on the
 *     deal, but the Hub deliberately does not read them — see `DEAL_COLUMNS`.
 *     Whoever sends the handoff is BuildSuite, which already holds them; this
 *     mapping reports them missing rather than widening what the Hub reads.
 *
 * None of these is resolved here. §5 and §8.2 are verbatim contracts and the
 * shared key is open decision C-3 — resolving it by choosing is exactly the
 * mistake the contributing rules warn about. What this file does is **fail
 * precisely**, so the ask to Sing and Chris carries field names and counts.
 * ---------------------------------------------------------------------------
 */

/**
 * The two real shapes of `projects.project_code`, confirmed by Sing 2026-09-03
 * against deployed BuildSuite code. Allocation is a Postgres function at insert
 * time, never application code, so these are the only shapes that exist.
 *
 *   BSA-044        feed and client projects, one Alliance-wide series
 *   BSA-ASJF-006   contractor-created, four letters the contractor picks at
 *                  first login, then their own running count
 *
 * A code is permanent. Winning a feed project does not rename it; the winner's
 * own number goes to `award_code` instead. **Identity keys on `project_code`,
 * always** — that is Sing's instruction and the reason this file no longer
 * falls back to `projects.id`.
 */
export const PROJECT_CODE_PATTERNS = {
  feed: /^BSA-\d+$/,
  contractor: /^BSA-[A-Z]{2,6}-\d+$/,
} as const;

export type ProjectCodeState = 'pending' | 'feed' | 'contractor' | 'malformed';

/**
 * Classify a `project_code`, distinguishing **pending from missing**.
 *
 * Roughly half of BuildSuite's project codes are null and that is NOT a data
 * fault: a contractor-created project stays null until that contractor picks
 * their four letters, and every one of their existing projects is numbered
 * oldest-first the moment they do. So a null is a state that resolves itself,
 * and the Hub renders it as pending rather than erroring on it.
 */
export function classifyProjectCode(code: string | null): ProjectCodeState {
  if (code === null || code.trim() === '') return 'pending';
  const value = code.trim();
  if (PROJECT_CODE_PATTERNS.feed.test(value)) return 'feed';
  if (PROJECT_CODE_PATTERNS.contractor.test(value)) return 'contractor';
  return 'malformed';
}

/** True once a code is a real, usable identity. */
export function hasUsableProjectCode(code: string | null): boolean {
  const state = classifyProjectCode(code);
  return state === 'feed' || state === 'contractor';
}

/** What the Hub can see, and what BuildSuite must add. */
export interface HandoffGap {
  field: keyof HandoffPayload | 'client.email' | 'client.phone';
  /** Why the Hub cannot supply it. */
  reason: string;
  /** Who has to resolve it. */
  owner: 'BuildSuite' | 'decision';
}

export type HandoffAttempt =
  | { ok: true; payload: HandoffPayload }
  | { ok: false; gaps: HandoffGap[]; partial: Partial<HandoffPayload> };

/** What the Hub can read about the project behind a deal. */
export interface HandoffProjectFacts {
  /** `projects.id` — a UUID today. */
  id: string;
  /** `projects.project_code` — `BSA-NNN`, populated on 48 of 101. */
  projectCode: string | null;
  title: string;
  address: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  /** A real number if BuildSuite ever holds one. `exact_budget` is the candidate. */
  contractAmount: number | null;
}

/**
 * Attempt the mapping, and name every gap rather than throwing on the first.
 *
 * The handoff fires once per signed proposal. A partial error report means a
 * second failed round-trip for the same payload, which is the same reasoning
 * `validateHandoffPayload` already follows.
 */
export function buildHandoffFromDeal(deal: Deal, project: HandoffProjectFacts): HandoffAttempt {
  const gaps: HandoffGap[] = [];

  // 1 · The shared key. Per C-3's proposed resolution BuildSuite generates it
  //     and GoHighLevel copies it — so BuildSuite is the one that must mint a
  //     value in the contracted format. Neither column it has today is one.
  //
  //     DELIBERATELY UNCHANGED as of 2026-09-03, though Sing has now confirmed
  //     what the key is. Resolving it here means editing §5, a verbatim
  //     contract, and the guard test on this branch exists precisely to stop
  //     this mapping from resolving C-3 on its own. `classifyProjectCode` above
  //     records what Sing confirmed so the answer is not lost; wiring it in is
  //     Chris's call to make, not this file's.
  const key = project.projectCode ?? project.id;
  if (!/^BSP-\d{4}-\d{6}$/.test(key)) {
    gaps.push({
      field: 'buildsuite_project_id',
      reason:
        `"${key}" is not BSP-YYYY-NNNNNN (§5). BuildSuite has no column in that format: ` +
        'projects.id is a UUID and projects.project_code is BSA-NNN. Either BuildSuite mints ' +
        'the contracted id, or §5 changes — this is open decision C-3 and not ours to pick.',
      owner: 'decision',
    });
  }

  // 2 · The money. A band is not an amount.
  if (project.contractAmount === null) {
    gaps.push({
      field: 'contract_amount',
      reason:
        `the deal carries a budget band ("${deal.budgetRange}"), not a contract amount. ` +
        'A signed proposal has a real figure; it must travel with the handoff.',
      owner: 'BuildSuite',
    });
  }

  // 3 · The client. Present in BuildSuite, deliberately unread by the Hub.
  if (project.clientEmail === null || project.clientEmail.trim() === '') {
    gaps.push({
      field: 'client.email',
      reason: 'the Hub does not select client_email (DEAL_COLUMNS); BuildSuite holds it and sends it',
      owner: 'BuildSuite',
    });
  }
  if (project.clientPhone === null || project.clientPhone.trim() === '') {
    gaps.push({
      field: 'client.phone',
      reason: 'the Hub does not select client_phone (DEAL_COLUMNS); BuildSuite holds it and sends it',
      owner: 'BuildSuite',
    });
  }

  const name = project.title.trim() === '' ? deal.projectType : project.title;
  if (name.trim() === '') {
    gaps.push({ field: 'project_name', reason: 'the project has no title and the deal no type', owner: 'BuildSuite' });
  }
  if (project.address.trim() === '') {
    gaps.push({ field: 'project_address', reason: 'the project has no address', owner: 'BuildSuite' });
  }

  const partial: Partial<HandoffPayload> = {
    buildsuite_project_id: key,
    project_name: name,
    project_address: project.address,
    ...(project.contractAmount !== null ? { contract_amount: project.contractAmount } : {}),
    client: {
      name: project.clientName === '' ? deal.clientName : project.clientName,
      email: project.clientEmail ?? '',
      phone: project.clientPhone ?? '',
    },
  };

  if (gaps.length > 0) return { ok: false, gaps, partial };

  // Belt and braces: the contract validates it too, so a gap this function
  // forgot still cannot produce an "ok" payload.
  const issues = validateHandoffPayload(partial);
  if (issues.length > 0) {
    return {
      ok: false,
      partial,
      gaps: issues.map((issue) => ({
        field: issue.field as HandoffGap['field'],
        reason: `${issue.message} (caught by the §8.2 validator, not by this mapping)`,
        owner: 'BuildSuite' as const,
      })),
    };
  }

  return { ok: true, payload: partial as HandoffPayload };
}

/** Group the gaps by who has to act. Used by the rehearsal and the spec. */
export function gapsByOwner(gaps: HandoffGap[]): Record<HandoffGap['owner'], HandoffGap[]> {
  return {
    BuildSuite: gaps.filter((g) => g.owner === 'BuildSuite'),
    decision: gaps.filter((g) => g.owner === 'decision'),
  };
}
