import { test } from 'node:test';
import assert from 'node:assert/strict';

import { healthReport } from './health.ts';

/**
 * The health report.
 *
 * Two things it must never do, and both are easier to get wrong than right:
 * report a secret, and report a customer's data. The rest is detail.
 *
 * These run without a database — the Hub and BuildSuite are unconfigured in
 * the test environment, which is itself the most important case: a report that
 * throws when the database is down is useless exactly when it is needed.
 */

const env = (over: Record<string, string> = {}) =>
  ({
    SESSION_SECRET: 'x'.repeat(32),
    GHL_API_BASE_URL: 'https://ghl.test',
    GHL_API_VERSION: '2021-07-28',
    GHL_PRIVATE_INTEGRATION_TOKEN: 'pit-secret-value-nobody-should-see',
    GHL_LOCATION_TOKENS: 'IifYfP2B2NUaoDPdsTTa:another-secret-token',
    GHL_MENU_LINK_SECRET: 'menu-secret',
    GHL_WEBHOOK_SECRET: 'webhook-secret',
    CRON_SECRET: 'cron-secret',
    ...over,
  }) as unknown as NodeJS.ProcessEnv;

test('§ no secret ever appears in the report', () => {
  // A page that prints the first eight characters of a key has printed a key.
  // "Set" is the whole answer.
  return healthReport(env()).then((report) => {
    const text = JSON.stringify(report);
    for (const secret of [
      'pit-secret-value-nobody-should-see',
      'another-secret-token',
      'menu-secret',
      'webhook-secret',
      'cron-secret',
      'x'.repeat(32),
    ]) {
      assert.equal(text.includes(secret), false, `the report leaks ${secret.slice(0, 12)}…`);
    }
  });
});

test('§ it answers rather than throwing when the databases are unreachable', async () => {
  // The case it exists for. A report that only works when everything works is
  // a report nobody can use during an outage.
  const report = await healthReport(env());
  assert.equal(report.state, 'fail');
  assert.ok(report.checks.some((c) => c.name === 'buildsuite'));
  assert.ok(report.checks.some((c) => c.name === 'hub-database'));
});

test('§ the overall state is the worst of its parts', async () => {
  // A monitor reads one value. If a single broken check could hide behind
  // nineteen healthy ones, the one value is a lie.
  const report = await healthReport(env());
  assert.equal(
    report.state,
    report.checks.some((c) => c.state === 'fail') ? 'fail' : report.state,
  );
  assert.ok(report.checks.length >= 10, 'suspiciously few checks');
});

test('an unset SESSION_SECRET is a failure, not a warning', async () => {
  // Nothing can be signed without it: no session, for anybody.
  const report = await healthReport(env({ SESSION_SECRET: 'too-short' }));
  const check = report.checks.find((c) => c.name === 'session-secret');
  assert.equal(check?.state, 'fail');
});

test('§ flags that are dangerous left on are warnings, not silence', async () => {
  const report = await healthReport(env({ ENABLE_DEMO_SIGNIN: 'true', GHL_AUTO_CONNECT: 'true' }));
  assert.equal(report.checks.find((c) => c.name === 'demo-sign-in')?.state, 'warn');
  assert.equal(report.checks.find((c) => c.name === 'auto-connect')?.state, 'warn');

  const off = await healthReport(env());
  assert.equal(off.checks.find((c) => c.name === 'demo-sign-in')?.state, 'ok');
});

test('email being off is reported, because it is the one everybody forgets', async () => {
  const report = await healthReport(env());
  const check = report.checks.find((c) => c.name === 'email-sending');
  assert.equal(check?.state, 'warn');
  assert.match(check?.detail ?? '', /not being sent/);

  const on = await healthReport(env({ GHL_SEND_EMAIL: 'true' }));
  assert.equal(on.checks.find((c) => c.name === 'email-sending')?.state, 'ok');
});

test('§ nobody having the operator controls is reported', async () => {
  // Set it and forget it is exactly how ADMIN_LOCATION_IDS stays unset.
  const none = await healthReport(env());
  assert.match(none.checks.find((c) => c.name === 'operator-controls')?.detail ?? '', /unset/);

  const some = await healthReport(env({ ADMIN_LOCATION_IDS: 'IifYfP2B2NUaoDPdsTTa' }));
  assert.equal(some.checks.find((c) => c.name === 'operator-controls')?.state, 'ok');
});

test('the fallback tokens are counted, never printed', async () => {
  const report = await healthReport(env());
  const check = report.checks.find((c) => c.name === 'ghl-fallback-tokens');
  assert.match(check?.detail ?? '', /1 Private Integration token/);
  assert.equal(check?.detail.includes('another-secret-token'), false);
});
