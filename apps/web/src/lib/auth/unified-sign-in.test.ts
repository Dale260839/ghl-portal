import assert from 'node:assert/strict';
import test from 'node:test';

import type { ClientCodeOutcome, ProvisionedClient } from './client-credentials.ts';
import { createRateLimiter, PASSWORD_SIGN_IN_LIMIT } from './rate-limit.ts';
import {
  looksLikeProjectCode,
  SIGN_IN_FAILED,
  unifiedSignIn,
  type AuthenticatedMember,
  type DemoIdentity,
  type MemberAuthenticator,
  type UnifiedSignInDeps,
} from './unified-sign-in.ts';

/**
 * The one sign-in, and how it tells a homeowner from a field worker.
 *
 * What matters here is less the happy paths than the four properties the
 * single form must not lose by merging two doors: the project code's strict
 * attempt limit, a failure that says nothing about which half was wrong, an
 * outage that is never reported as a wrong password, and demo identities that
 * are shut unless a deployment deliberately opens them.
 */

const CREW: AuthenticatedMember = {
  id: 'm-crew',
  email: 'tony@crew.example',
  fullName: 'Tony Field',
  role: 'field',
  authProfileIds: ['profile-1'],
};

const HOMEOWNER: ProvisionedClient = {
  id: 'm-home',
  email: 'owner@example.com',
  fullName: 'Dana Owner',
  role: 'client',
  projectIds: ['p-1'],
};

/** The Hub's password check: one field worker, with one password. */
function members(over: { password?: string; reason?: 'revoked' | 'not-activated' } = {}) {
  const calls: { email: string; password: string }[] = [];
  const impl: MemberAuthenticator = {
    async authenticate(email, password) {
      calls.push({ email, password });
      if (email.trim().toLowerCase() !== CREW.email) return { ok: false, reason: 'unknown' };
      if (password !== (over.password ?? 'correct horse battery')) return { ok: false, reason: 'unknown' };
      if (over.reason !== undefined) return { ok: false, reason: over.reason };
      return { ok: true, membership: CREW };
    },
  };
  return { impl, calls };
}

/** The homeowner check, answering whatever the test says it answers. */
function codes(answer: ClientCodeOutcome = { result: 'rejected' }) {
  const calls: { email: string; code: string }[] = [];
  const impl = async (email: string, code: string): Promise<ClientCodeOutcome> => {
    calls.push({ email, code });
    return answer;
  };
  return { impl, calls };
}

function deps(over: Partial<UnifiedSignInDeps> = {}): UnifiedSignInDeps {
  return {
    member: members().impl,
    code: codes().impl,
    limiter: createRateLimiter(PASSWORD_SIGN_IN_LIMIT),
    ip: '203.0.113.9',
    demo: null,
    now: 1_000_000,
    ...over,
  };
}

function message(outcome: Awaited<ReturnType<typeof unifiedSignIn>>): string {
  return outcome.result === 'refused' ? outcome.message : `(not refused: ${outcome.result})`;
}

// ── Routing: the shape of the secret decides the door ──────────────────────

test('a project code goes to the homeowner check, and only there', async () => {
  const code = codes({ result: 'signed-in', membership: HOMEOWNER });
  const member = members();

  const outcome = await unifiedSignIn(
    'owner@example.com',
    'BSA-053',
    deps({ code: code.impl, member: member.impl }),
  );

  assert.equal(outcome.result, 'client');
  assert.deepEqual(code.calls, [{ email: 'owner@example.com', code: 'BSA-053' }]);
  assert.equal(member.calls.length, 0, 'a homeowner who signed in is never tried as a password');
});

test('a code typed the way people type it is still a code', () => {
  // The homeowner lookup accepts all of these (`normalizeProjectCode`). If the
  // router judged the raw text, `bsa 53` would go down the password path and
  // fail, and the homeowner would be told their correct code is wrong.
  for (const typed of ['BSA-053', 'bsa-053', ' BSA 053 ', 'bsa 53', 'BSA-APS-003', 'bsa-aps-3']) {
    assert.equal(looksLikeProjectCode(typed), true, typed);
  }
  for (const typed of ['correct horse battery', 'BSA', 'BSA-', 'hunter2hunter2', 'BSA053x']) {
    assert.equal(looksLikeProjectCode(typed), false, typed);
  }
});

test('field crew sign in with their password', async () => {
  const code = codes();
  const outcome = await unifiedSignIn(
    'tony@crew.example',
    'correct horse battery',
    deps({ code: code.impl }),
  );

  assert.equal(outcome.result, 'member');
  assert.equal(outcome.result === 'member' && outcome.membership.role, 'field');
  assert.equal(code.calls.length, 0, 'a password never reaches the homeowner check');
});

test('a password that happens to look like a code still works for the crew member who chose it', async () => {
  const member = members({ password: 'BSA-777' });
  const outcome = await unifiedSignIn('tony@crew.example', 'BSA-777', deps({ member: member.impl }));

  assert.equal(outcome.result, 'member');
  assert.deepEqual(member.calls, [{ email: 'tony@crew.example', password: 'BSA-777' }]);
});

// ── The limits survive the merge ───────────────────────────────────────────

test('a code-shaped guess spends the CODE budget, not the password one', async () => {
  // The homeowner check counts its own attempts, five an hour. Falling back to
  // the password check must not also spend a password attempt.
  const limiter = createRateLimiter(PASSWORD_SIGN_IN_LIMIT);
  for (let i = 0; i < 20; i++) {
    await unifiedSignIn('owner@example.com', `BSA-${100 + i}`, deps({ limiter }));
  }
  const decision = limiter.consume(['pw:email:owner@example.com'], { now: 1_000_000 });
  assert.equal(decision.allowed, true, 'twenty code guesses left the password budget untouched');
});

test('a rate-limited code is refused outright, never retried as a password', async () => {
  const code = codes({ result: 'rate_limited', retryAfterSeconds: 1800 });
  const member = members({ password: 'BSA-053' });

  const outcome = await unifiedSignIn(
    'tony@crew.example',
    'BSA-053',
    deps({ code: code.impl, member: member.impl }),
  );

  assert.equal(outcome.result, 'refused');
  assert.match(message(outcome), /Too many attempts\. Try again in 30 minutes/);
  assert.equal(member.calls.length, 0, 'the password check must not become a way past the code limit');
});

test('passwords are limited too — they were not, before this', async () => {
  const member = members();
  const limiter = createRateLimiter(PASSWORD_SIGN_IN_LIMIT);
  const d = deps({ member: member.impl, limiter });

  for (let i = 0; i < PASSWORD_SIGN_IN_LIMIT.limit; i++) {
    const wrong = await unifiedSignIn('tony@crew.example', `guess-${i}`, d);
    assert.equal(message(wrong), SIGN_IN_FAILED);
  }
  const callsBefore = member.calls.length;

  // Over the limit, even the RIGHT password is refused, and the database is
  // not asked — a refused caller learns nothing, not even by timing.
  const blocked = await unifiedSignIn('tony@crew.example', 'correct horse battery', d);
  assert.equal(blocked.result, 'refused');
  assert.match(message(blocked), /Too many attempts/);
  assert.equal(member.calls.length, callsBefore);
});

test('a real sign-in clears the password counter', async () => {
  const limiter = createRateLimiter(PASSWORD_SIGN_IN_LIMIT);
  const d = deps({ limiter });
  for (let i = 0; i < PASSWORD_SIGN_IN_LIMIT.limit - 1; i++) {
    await unifiedSignIn('tony@crew.example', `guess-${i}`, d);
  }
  assert.equal((await unifiedSignIn('tony@crew.example', 'correct horse battery', d)).result, 'member');

  // Without the reset, a crew member who fumbled twice this morning would be
  // locked out by their next typo this afternoon.
  for (let i = 0; i < PASSWORD_SIGN_IN_LIMIT.limit - 1; i++) {
    await unifiedSignIn('tony@crew.example', `later-${i}`, d);
  }
  assert.equal((await unifiedSignIn('tony@crew.example', 'correct horse battery', d)).result, 'member');
});

// ── One failure, whatever was wrong ────────────────────────────────────────

test('every wrong-credential failure reads the same', async () => {
  // Otherwise the form answers "is this email on file?" and "is this the
  // homeowner of a signed job?" for anyone who asks.
  const answers = [
    await unifiedSignIn('nobody@example.com', 'some password here', deps()),
    await unifiedSignIn('tony@crew.example', 'the wrong password', deps()),
    await unifiedSignIn('owner@example.com', 'BSA-999', deps()),
    await unifiedSignIn('tony@crew.example', 'BSA-999', deps()),
    await unifiedSignIn('owner@example.com', '', deps()),
    await unifiedSignIn('   ', 'BSA-053', deps()),
  ];
  for (const a of answers) assert.deepEqual(a, { result: 'refused', message: SIGN_IN_FAILED });
});

test('revoked and not-yet-activated are named — only after the password was right', async () => {
  const revoked = await unifiedSignIn(
    'tony@crew.example',
    'correct horse battery',
    deps({ member: members({ reason: 'revoked' }).impl }),
  );
  assert.match(message(revoked), /no longer has access/);

  const pending = await unifiedSignIn(
    'tony@crew.example',
    'correct horse battery',
    deps({ member: members({ reason: 'not-activated' }).impl }),
  );
  assert.match(message(pending), /invitation link/);
});

// ── Outages are outages ────────────────────────────────────────────────────

test('the Hub being down is never reported as a wrong password', async () => {
  const outcome = await unifiedSignIn('tony@crew.example', 'correct horse battery', deps({ member: null }));
  assert.equal(outcome.result, 'refused');
  assert.notEqual(message(outcome), SIGN_IN_FAILED);
  assert.match(message(outcome), /try again in a moment/);
});

test('BuildSuite being down is never reported as a wrong project code', async () => {
  const outcome = await unifiedSignIn(
    'owner@example.com',
    'BSA-053',
    deps({ code: codes({ result: 'unavailable' }).impl }),
  );
  assert.match(message(outcome), /try again in a moment/);
});

// ── Demo identities are shut by default ───────────────────────────────────

const DEMO: DemoIdentity = {
  role: 'contractor',
  name: 'Marcus Reyes',
  email: 'marcus@allianceproservices.com',
  authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40'],
};
const demoLookup = (email: string) => (email.trim().toLowerCase() === DEMO.email ? DEMO : undefined);

test('with demo off — as on every deployment — a demo email gets nothing', async () => {
  // This is the door the old page left open: a demo identity carries a REAL
  // BuildSuite profile and has no password.
  const outcome = await unifiedSignIn(DEMO.email, 'anything at all', deps({ demo: null }));
  assert.deepEqual(outcome, { result: 'refused', message: SIGN_IN_FAILED });
});

test('with demo on, a demo email signs in — and a real account still wins over it', async () => {
  const on = await unifiedSignIn(DEMO.email, 'anything at all', deps({ demo: demoLookup }));
  assert.equal(on.result, 'demo');

  // A real member sharing the email must never be shadowed by the demo.
  const both = await unifiedSignIn(
    'tony@crew.example',
    'correct horse battery',
    deps({ demo: (email) => (email === 'tony@crew.example' ? { ...DEMO, email } : undefined) }),
  );
  assert.equal(both.result, 'member');
});

test('a demo email never unlocks the homeowner path', async () => {
  const outcome = await unifiedSignIn(DEMO.email, 'BSA-053', deps({ demo: demoLookup }));
  assert.deepEqual(outcome, { result: 'refused', message: SIGN_IN_FAILED });
});
