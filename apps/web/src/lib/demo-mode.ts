import 'server-only';

import { cookies } from 'next/headers';

import type { TenantScope } from './tenancy.ts';

/**
 * Demo data mode — a toggle in the header that swaps the whole app onto
 * fixtures (D-017, temporary).
 *
 * It exists because wiring the real BuildSuite data made the demo *worse* in one
 * specific way. BuildSuite holds projects, clients and dates; it holds no field
 * updates, milestones, documents or photos, because those are the `hub_*` tables
 * and they do not exist yet. So on real data the review queue is empty — and the
 * review queue is the spine of the walkthrough. The choice was between showing
 * invented updates beside real projects (which is indistinguishable from the
 * product working, and the one thing that must never happen) or having a
 * deliberate, labelled switch.
 *
 * ---------------------------------------------------------------------------
 * DEMO MODE ALSO SUPPLIES THE TENANT, and it has to.
 *
 * The fixtures belong to two invented profiles. A contractor signed in through
 * GoHighLevel carries their real profile ids, which overlap the fixtures by
 * exactly one — so flipping only the data source would show them *half* the
 * sample projects and no explanation of why.
 *
 * So demo mode says: for as long as this is on, you are the demo agency. Every
 * read is still scoped, still filtered, still refuses an absent scope — the
 * scope is simply a fictional one. The tenancy invariant is intact; only the
 * identity behind it is pretend.
 * ---------------------------------------------------------------------------
 *
 * Delete this file when the `hub_*` tables are live and the real data can carry
 * a walkthrough on its own.
 */

const COOKIE = 'bs_demo_data';

/** The fixtures' own owners — see `data/fixtures.ts`. */
export const DEMO_SCOPE: TenantScope = {
  locationId: 'loc_alliance_pro',
  authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40', 'a4502e38-bb67-420b-a7fc-3e1bc3d99c01'],
};

export async function isDemoData(): Promise<boolean> {
  if (!demoToggleEnabled()) return false;
  return (await cookies()).get(COOKIE)?.value === 'on';
}

export async function setDemoData(on: boolean): Promise<void> {
  const jar = await cookies();
  if (on) {
    jar.set(COOKIE, 'on', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 12,
    });
  } else {
    jar.delete(COOKIE);
  }
}

/**
 * Off switch.
 *
 * Defaults on, because the demo runs on the deployed site and one more required
 * environment variable is one more thing to forget. Set `DISABLE_DEMO_DATA=true`
 * to remove the toggle — worth doing before real contractors use this daily, at
 * which point this file should be deleted rather than disabled.
 */
export function demoToggleEnabled(): boolean {
  return process.env.DISABLE_DEMO_DATA !== 'true';
}
