import 'server-only';

import { getHubClient } from './hub-db/client.ts';
import { getBuildSuiteReader } from './buildsuite/projects.ts';
import { readGhlConfig, readLocationTokens } from './ghl/config.ts';
import { oauthEnabled, agencyEnabled, autoConnectEnabled } from './ghl/oauth-config.ts';
import { adminLocationIds } from './admin-access.ts';

/**
 * Is this deployment actually working? (Dale, 2026-10-02.)
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Two things broke in one week and **we found out both times from a human**:
 * the BuildSuite outage arrived as a note from Sing, and the operator controls
 * showing to every contractor arrived as a screenshot. Nothing in the system
 * says "I cannot reach the database" until somebody cannot sign in.
 *
 * With 149 sub-accounts live, that is the gap worth closing. Everything below
 * is a failure mode we have actually hit in the last ten days.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not write, and it does not report business data — no project names,
 * no client names, no figures. It reports whether the *connections* are alive
 * and which migrations have landed. A health page that shows a contractor's
 * projects is a back door with a friendly name.
 *
 * Secrets are reported as present or absent, never echoed. "Set" is the whole
 * answer; a page that prints the first eight characters of a key has printed a
 * key.
 * ---------------------------------------------------------------------------
 */

export type CheckState = 'ok' | 'warn' | 'fail';

export interface Check {
  /** Short, and the same string every time so it can be grepped in a log. */
  name: string;
  state: CheckState;
  /** One line a person can act on. Never a secret, never a customer's data. */
  detail: string;
}

export interface HealthReport {
  checkedAt: string;
  /** The worst state found — what a monitor would alert on. */
  state: CheckState;
  checks: Check[];
}

function worst(checks: readonly Check[]): CheckState {
  if (checks.some((c) => c.state === 'fail')) return 'fail';
  if (checks.some((c) => c.state === 'warn')) return 'warn';
  return 'ok';
}

function readFailure(error: unknown): string {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status: unknown }).status
    : null;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? `read failed (HTTP ${status})`
    : 'read could not be confirmed';
}

/** A migration, identified by the column it adds rather than by its number. */
const MIGRATIONS: { id: string; table: string; columns: string[]; why: string }[] = [
  {
    id: '0015',
    table: 'hub_photos',
    columns: ['task_id'],
    why: 'a task cannot list its own photos',
  },
  {
    id: '0016',
    table: 'hub_ghl_oauth',
    columns: ['location_id'],
    why: 'a sub-account cannot connect itself',
  },
  {
    id: '0017',
    table: 'hub_ghl_agency',
    columns: ['company_id'],
    why: 'the agency install has nowhere to be stored',
  },
  {
    id: '0019',
    table: 'hub_photos',
    columns: ['update_id'],
    why: 'photographs cannot belong to the update they were sent with',
  },
];

async function databaseChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  // ── BuildSuite ────────────────────────────────────────────────────────────
  //
  // One cheap read. On 29 September every table answered 401 because `anon`
  // had been revoked, and the first anybody knew was a contractor who could
  // not sign in. This is that, found in a second.
  const reader = getBuildSuiteReader();
  if (!reader.available) {
    checks.push({
      name: 'buildsuite',
      state: 'fail',
      detail: `not configured — missing ${reader.missing.join(', ')}`,
    });
  } else {
    try {
      await reader.listAuthProfileIdsForLocation('health-check-no-such-location');
      checks.push({ name: 'buildsuite', state: 'ok', detail: 'readable' });
    } catch (error) {
      checks.push({
        name: 'buildsuite',
        state: 'fail',
      detail: `${readFailure(error)}. Check server credentials and database availability.`,
      });
    }
  }

  // ── The Hub, and what has been migrated ──────────────────────────────────
  const hub = getHubClient();
  if (!hub.available) {
    checks.push({
      name: 'hub-database',
      state: 'fail',
      detail: `not connected — missing ${hub.missing.join(', ')}`,
    });
    return checks;
  }

  try {
    await hub.client.select({ from: 'hub_project_state', columns: ['id'], limit: 0 });
    checks.push({ name: 'hub-database', state: 'ok', detail: 'readable' });
  } catch (error) {
    checks.push({
      name: 'hub-database',
      state: 'fail',
      detail: readFailure(error),
    });
    return checks;
  }

  for (const migration of MIGRATIONS) {
    // Health must probe now, not reuse a process-wide compatibility result.
    try {
      await hub.client.select({ from: migration.table, columns: migration.columns, limit: 0 });
      checks.push({
        name: `migration-${migration.id}`,
        state: 'ok',
        detail: 'required columns readable; full migration state not verified',
      });
    } catch (error) {
      checks.push({
        name: `migration-${migration.id}`,
        state: 'fail',
        detail: `${readFailure(error)}; column availability unconfirmed. ${migration.why}.`,
      });
    }
  }

  return checks;
}

function configChecks(env: NodeJS.ProcessEnv): Check[] {
  const checks: Check[] = [];
  const ghl = readGhlConfig(env);

  checks.push({
    name: 'ghl-credentials',
    state: ghl.configured || oauthEnabled(env) || agencyEnabled(env) ? 'ok' : 'fail',
    detail: ghl.configured || oauthEnabled(env) || agencyEnabled(env)
      ? 'credential configuration present; token validity and installation not verified'
      : `missing ${ghl.missing.join(', ')}`,
  });

  checks.push({
    name: 'ghl-marketplace',
    state: oauthEnabled(env) ? 'ok' : 'warn',
    detail: oauthEnabled(env)
      ? 'configured; individual installs and token validity not verified'
      : 'off — everything runs on Private Integration tokens',
  });

  checks.push({
    name: 'ghl-agency-signin',
    state: agencyEnabled(env) ? 'ok' : 'warn',
    detail: agencyEnabled(env)
      ? 'credential configuration present; user sign-in not verified'
      : 'off — a sub-account with no credential of its own cannot sign in',
  });

  const pits = readLocationTokens(env).size;
  checks.push({
    name: 'ghl-fallback-tokens',
    state: 'ok',
    detail:
      pits === 0
        ? 'none configured — nothing to remove'
        : `${pits} Private Integration token${pits === 1 ? '' : 's'} still configured as a fallback`,
  });

  // Not a secret, and the one everybody forgets: with it off, every invitation
  // and every notification is silently not sent.
  checks.push({
    name: 'email-sending',
    state: env.GHL_SEND_EMAIL === 'true' ? 'ok' : 'warn',
    detail:
      env.GHL_SEND_EMAIL === 'true'
        ? 'on'
        : 'OFF — invitations and notifications are not being sent',
  });

  const admins = adminLocationIds(env).length;
  checks.push({
    name: 'operator-controls',
    state: admins > 0 ? 'ok' : 'warn',
    detail:
      admins > 0
        ? `${admins} sub-account${admins === 1 ? '' : 's'} may switch account and view as`
        : 'ADMIN_LOCATION_IDS is unset — nobody has them, including the agency',
  });

  checks.push({
    name: 'menu-link-signing',
    state: (env.GHL_MENU_LINK_SECRET ?? '').trim() === '' ? 'warn' : 'ok',
    detail:
      (env.GHL_MENU_LINK_SECRET ?? '').trim() === ''
      ? 'signed bridge not configured; unsigned location links are refused'
      : 'signed bridge configured; live sign-in not verified',
  });

  const ssoConfigured = (env.GHL_APP_SHARED_SECRET ?? '').trim() !== '' &&
    (env.GHL_SSO_COMPANY_ID ?? '').trim() !== '';
  checks.push({
    name: 'ghl-user-context',
    state: ssoConfigured ? 'ok' : 'warn',
    detail: ssoConfigured
      ? 'server context configuration present; Custom Page handshake not verified'
      : 'server context configuration incomplete; verify secure GHL entry before release',
  });

  checks.push({
    name: 'webhooks',
    state: 'warn',
    detail: [env.GHL_WEBHOOK_ED25519_PUBLIC_KEY, env.GHL_WEBHOOK_PUBLIC_KEY, env.GHL_WEBHOOK_SECRET]
      .some((key) => (key ?? '').trim() !== '')
      ? 'verification configuration present; durable workflow execution unavailable'
      : 'verification configuration absent; delivery history and execution not verified',
  });

  checks.push({
    name: 'session-secret',
    state: (env.SESSION_SECRET ?? '').length >= 32 ? 'ok' : 'fail',
    detail:
      (env.SESSION_SECRET ?? '').length >= 32
        ? 'set'
        : 'missing or too short — sessions cannot be signed',
  });

  // Flags that are dangerous left on in production, rather than merely unset.
  for (const [name, on, why] of [
    ['demo-sign-in', env.ENABLE_DEMO_SIGNIN === 'true', 'demo accounts can sign in without a password'],
    ['auto-connect', autoConnectEnabled(env), 'contractors are redirected to a login most of them do not have'],
  ] as const) {
    checks.push({
      name,
      state: on ? 'warn' : 'ok',
      detail: on ? `ON — ${why}` : 'off',
    });
  }

  return checks;
}

export async function healthReport(env: NodeJS.ProcessEnv = process.env): Promise<HealthReport> {
  const checks = [...configChecks(env), ...(await databaseChecks())];
  return { checkedAt: new Date().toISOString(), state: worst(checks), checks };
}
