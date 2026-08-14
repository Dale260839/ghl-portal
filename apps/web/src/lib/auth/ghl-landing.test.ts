/**
 * GHL Custom Menu Link landing (D-011).
 *
 * The thing under test is a refusal, not a feature: merge-field query parameters
 * are not authentication, and a session minted from them would let a stranger
 * pick which contractor's data to receive. Most of these prove we say no.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalString,
  describeRejection,
  signLanding,
  verifyLanding,
  type LandingParams,
} from './ghl-landing.ts';

const SECRET = 'shared-secret-from-ghl-menu-link';
const NOW = 1_800_000_000;

const params: LandingParams = {
  locationId: 'loc_alliance_pro',
  userId: 'usr_marcus',
  email: 'marcus@allianceproservices.com',
  timestamp: String(NOW),
};

function signed(overrides: Partial<LandingParams> = {}): LandingParams {
  const base = { ...params, ...overrides };
  return { ...base, signature: signLanding(base, SECRET) };
}

// ── Refusals ─────────────────────────────────────────────────────────────────

test('an unsigned landing is refused when a secret is configured', () => {
  const result = verifyLanding(params, { signingSecret: SECRET, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.reason : '', 'unsigned');
});

test('a forged locationId is refused — the whole point', () => {
  // Someone takes their own working link and swaps the sub-account.
  const legit = signed();
  const forged = { ...legit, locationId: 'loc_someone_else' };
  const result = verifyLanding(forged, { signingSecret: SECRET, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.reason : '', 'bad_signature');
});

test('changing any signed field breaks the signature', () => {
  const legit = signed();
  for (const field of ['locationId', 'userId', 'email', 'timestamp'] as const) {
    const tampered = { ...legit, [field]: 'tampered' };
    assert.equal(
      verifyLanding(tampered, { signingSecret: SECRET, now: NOW }).ok,
      false,
      `${field} should be covered by the signature`,
    );
  }
});

test('a signature from a different secret is refused', () => {
  const other = { ...params, signature: signLanding(params, 'a-different-secret') };
  const result = verifyLanding(other, { signingSecret: SECRET, now: NOW });
  assert.equal(result.ok === false ? result.reason : '', 'bad_signature');
});

test('a captured link goes stale', () => {
  const legit = signed();
  assert.ok(verifyLanding(legit, { signingSecret: SECRET, now: NOW + 299 }).ok);
  const stale = verifyLanding(legit, { signingSecret: SECRET, now: NOW + 301 });
  assert.equal(stale.ok, false);
  assert.equal(stale.ok === false ? stale.reason : '', 'stale');
  // Clock skew in either direction is equally suspicious.
  assert.equal(verifyLanding(legit, { signingSecret: SECRET, now: NOW - 900 }).ok, false);
});

test('with nothing configured, a landing is refused rather than trusted', () => {
  const result = verifyLanding(params, {});
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.reason : '', 'not_configured');
});

test('an incomplete landing is reported precisely, not as a signature failure', () => {
  // A misconfigured menu link should look like a misconfigured menu link.
  assert.equal(
    verifyLanding({ ...params, locationId: '' }, { signingSecret: SECRET }).ok === false
      ? (verifyLanding({ ...params, locationId: '' }, { signingSecret: SECRET }) as { reason: string }).reason
      : '',
    'missing_location',
  );
  assert.equal(
    verifyLanding({ ...params, userId: '  ' }, { signingSecret: SECRET }).ok === false
      ? (verifyLanding({ ...params, userId: '  ' }, { signingSecret: SECRET }) as { reason: string }).reason
      : '',
    'missing_user',
  );
});

// ── Acceptances ──────────────────────────────────────────────────────────────

test('a correctly signed, fresh landing is accepted', () => {
  const result = verifyLanding(signed(), { signingSecret: SECRET, now: NOW });
  assert.ok(result.ok);
  assert.equal(result.locationId, 'loc_alliance_pro');
  assert.equal(result.userId, 'usr_marcus');
  assert.equal(result.email, 'marcus@allianceproservices.com');
  assert.equal(result.proof, 'signature');
});

test('development can opt in to unverified landings, and it is labelled', () => {
  const result = verifyLanding(params, { allowUnverified: true });
  assert.ok(result.ok);
  assert.equal(
    result.proof,
    'unverified_development',
    'the proof is recorded so an unverified session is never mistaken for a real one',
  );
});

test('a configured secret wins over the development escape hatch', () => {
  // Otherwise leaving the flag set in production would silently disable auth.
  const result = verifyLanding(params, { signingSecret: SECRET, allowUnverified: true });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.reason : '', 'unsigned');
});

// ── Details ──────────────────────────────────────────────────────────────────

test('the canonical string is order-stable so both sides agree', () => {
  const a = canonicalString({ locationId: 'l', userId: 'u', email: 'e', timestamp: '1' });
  const b = canonicalString({ timestamp: '1', email: 'e', userId: 'u', locationId: 'l' });
  assert.equal(a, b);
  assert.equal(a, 'locationId=l&userId=u&email=e&timestamp=1');
});

test('a missing field signs as empty rather than being skipped', () => {
  // Skipping would let {locationId:"a", userId:"b"} and {locationId:"a&userId=b"}
  // produce the same string — a classic signature-collision trick.
  assert.equal(canonicalString({ locationId: 'a' }), 'locationId=a&userId=&email=&timestamp=');
});

test('every rejection has a message that leaks nothing', () => {
  for (const reason of [
    'missing_location',
    'missing_user',
    'unsigned',
    'bad_signature',
    'stale',
    'not_configured',
  ] as const) {
    const message = describeRejection(reason);
    assert.ok(message.length > 0);
    assert.ok(!message.includes('loc_'), 'no identifiers in a user-facing message');
  }
});
