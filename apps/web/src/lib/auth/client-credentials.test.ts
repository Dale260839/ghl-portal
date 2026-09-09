import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clientCodeMessage,
  signInWithProjectCode,
  type ClientAccountStore,
  type ClientCodeOutcome,
  type ProvisionedClient,
  type SignedProjectForClient,
  type SignedProjectReader,
} from './client-credentials.ts';
import { createRateLimiter, CLIENT_CODE_LIMIT } from './rate-limit.ts';

/**
 * The homeowner's door, where the project code IS the password.
 *
 * The weakest factor in the system by a distance — `BSA-001` to `BSA-052`,
 * sequential, about six bits — so what is tested here is not "does the happy
 * path work" but every property that makes six bits survivable: the signature
 * gate, the indistinguishable failure, and a limiter that cannot be refreshed
 * by varying the thing being guessed.
 */

const SIGNED: SignedProjectForClient = {
  projectId: 'p-signed',
  contractorId: 'c-1',
  ghlContactId: 'ghl-1',
  clientName: 'Zander Garcia',
};

/** One project, signed. Anything else about it is wrong and finds nothing. */
function reader(over: Partial<Record<'code' | 'email', string>> = {}) {
  const code = over.code ?? 'BSA-052';
  const email = over.email ?? 'owner@example.com';
  const calls: { code: string; email: string }[] = [];
  const impl: SignedProjectReader = {
    async findSignedProjectForClient(projectCode, clientEmail) {
      calls.push({ code: projectCode, email: clientEmail });
      const matches =
        projectCode.trim().toUpperCase() === code && clientEmail.trim().toLowerCase() === email;
      return matches ? SIGNED : null;
    },
  };
  return { reader: impl, calls };
}

function store(over: { revoked?: boolean } = {}) {
  const writes: unknown[] = [];
  const impl: ClientAccountStore = {
    async provisionClientFromSignedProject(input) {
      writes.push(input);
      if (over.revoked === true) return { ok: false, reason: 'revoked' };
      const membership: ProvisionedClient = {
        id: 'm-1',
        email: input.email,
        fullName: input.clientName,
        role: 'client',
        projectIds: [input.projectId],
      };
      return { ok: true, membership };
    },
  };
  return { store: impl, writes };
}

function deps(over: Partial<Parameters<typeof signInWithProjectCode>[2]> = {}) {
  return {
    reader: reader().reader,
    store: store().store,
    limiter: createRateLimiter(CLIENT_CODE_LIMIT),
    ip: '203.0.113.9',
    ...over,
  };
}

// ── The happy path, and exactly what it grants ───────────────────────────────

test('the right email and the right code sign a homeowner in', async () => {
  const s = store();
  const outcome = await signInWithProjectCode('owner@example.com', 'BSA-052', deps({ store: s.store }));

  assert.equal(outcome.result, 'signed-in');
  assert.equal(outcome.result === 'signed-in' && outcome.membership.role, 'client');
  assert.deepEqual(s.writes, [
    { contractorId: 'c-1', email: 'owner@example.com', projectId: 'p-signed', clientName: 'Zander Garcia' },
  ]);
});

test('the account opened carries ONLY the project the code proved', async () => {
  // The whole scoping story. A code proves one project; if this ever returned
  // more, one code would open jobs its holder never had a code for.
  const outcome = await signInWithProjectCode('owner@example.com', 'BSA-052', deps());
  assert.equal(outcome.result, 'signed-in');
  if (outcome.result !== 'signed-in') return;
  assert.deepEqual(outcome.membership.projectIds, ['p-signed']);
});

test('a code is accepted however it was typed', async () => {
  // Read off a phone, retyped on a job site. Case and stray spaces are the
  // user being human, not the credential being wrong.
  for (const typed of ['bsa-052', ' BSA-052 ', 'Bsa-052']) {
    const outcome = await signInWithProjectCode('OWNER@Example.com ', typed, deps());
    assert.equal(outcome.result, 'signed-in', `rejected ${JSON.stringify(typed)}`);
  }
});

// ── The gate ─────────────────────────────────────────────────────────────────

test('a project with no signed contract admits nobody', async () => {
  // THE load-bearing rule. The reader returns null for an unsigned project, so
  // this asserts the policy HONOURS that rather than provisioning anyway.
  //
  // Verified on 2026-09-10 by replacing `if (found === null) return rejected`
  // with a fabricated project: this test went red, along with seven others.
  const s = store();
  const unsigned: SignedProjectReader = { async findSignedProjectForClient() { return null; } };

  const outcome = await signInWithProjectCode('owner@example.com', 'BSA-044', deps({
    reader: unsigned,
    store: s.store,
  }));

  assert.equal(outcome.result, 'rejected');
  assert.deepEqual(s.writes, [], 'an unsigned project must not open an account');
});

test('every way of failing looks the same', async () => {
  // The response is the only channel an enumerator has. A wrong code, a wrong
  // email and a stranger must be one outcome with no extra field between them,
  // or this form becomes a way to find out whose contracts have been signed.
  const outcomes: ClientCodeOutcome[] = [
    await signInWithProjectCode('owner@example.com', 'BSA-051', deps()),
    await signInWithProjectCode('owner@example.com', 'BSA-053', deps()),
    await signInWithProjectCode('stranger@example.com', 'BSA-052', deps()),
    await signInWithProjectCode('stranger@example.com', 'BSA-999', deps()),
    await signInWithProjectCode('', '', deps()),
  ];

  for (const outcome of outcomes) {
    assert.deepEqual(outcome, { result: 'rejected' });
  }
});

// ── Attempt limiting ─────────────────────────────────────────────────────────

test('the limit refuses the sixth attempt in the window', async () => {
  const d = deps();
  for (let i = 1; i <= CLIENT_CODE_LIMIT.limit; i += 1) {
    const outcome = await signInWithProjectCode('owner@example.com', `BSA-${100 + i}`, d);
    assert.equal(outcome.result, 'rejected', `attempt ${i} should still be allowed`);
  }

  const refused = await signInWithProjectCode('owner@example.com', 'BSA-052', d);
  assert.equal(refused.result, 'rate_limited');
  assert.ok(refused.result === 'rate_limited' && refused.retryAfterSeconds > 0);
});

test('a refused caller costs no database read', async () => {
  // Counted before the lookup, so hammering cannot be used to time real
  // addresses against invented ones, and cannot spend BuildSuite quota.
  const r = reader();
  const d = deps({ reader: r.reader });

  for (let i = 0; i < CLIENT_CODE_LIMIT.limit; i += 1) {
    await signInWithProjectCode('owner@example.com', 'BSA-001', d);
  }
  const before = r.calls.length;

  const refused = await signInWithProjectCode('owner@example.com', 'BSA-002', d);
  assert.equal(refused.result, 'rate_limited');
  assert.equal(r.calls.length, before, 'a refused attempt reached the reader');
});

test('varying the code does NOT buy more attempts', async () => {
  // The attack this limit exists to stop is walking the code space. If the code
  // were part of the key, every guess would get a fresh counter and the limit
  // would be worthless — verified by adding the code to `clientCodeKeys`, which
  // turns this test red.
  const d = deps();
  for (let code = 1; code <= CLIENT_CODE_LIMIT.limit; code += 1) {
    await signInWithProjectCode('owner@example.com', `BSA-${String(code).padStart(3, '0')}`, d);
  }

  const next = await signInWithProjectCode('owner@example.com', 'BSA-006', d);
  assert.equal(next.result, 'rate_limited');
});

test('one enumerator cannot walk many emails from one machine', async () => {
  // The IP key. Without it, the email key alone caps five per victim but lets a
  // single attacker spray hundreds of addresses at once.
  const d = deps({ ip: '198.51.100.7' });
  for (let i = 0; i < CLIENT_CODE_LIMIT.limit; i += 1) {
    await signInWithProjectCode(`victim${i}@example.com`, 'BSA-052', d);
  }

  const next = await signInWithProjectCode('another@example.com', 'BSA-052', d);
  assert.equal(next.result, 'rate_limited');
});

test('signing in clears the counter, and failing does not', async () => {
  const d = deps();
  // Four wrong, then the right one. The homeowner who fumbled the code must not
  // be locked out of their next visit an hour later.
  for (let i = 0; i < 4; i += 1) {
    await signInWithProjectCode('owner@example.com', 'BSA-001', d);
  }
  assert.equal((await signInWithProjectCode('owner@example.com', 'BSA-052', d)).result, 'signed-in');

  // A full fresh budget, which only a success can buy.
  for (let i = 0; i < CLIENT_CODE_LIMIT.limit; i += 1) {
    const outcome = await signInWithProjectCode('owner@example.com', 'BSA-001', d);
    assert.equal(outcome.result, 'rejected', `attempt ${i + 1} after success should be allowed`);
  }
});

test('a missing IP still leaves the email counted', async () => {
  // `clientIpFrom` returns '' behind an unexpected proxy. The counter that
  // stops the code walk must never be the one that goes absent.
  const d = deps({ ip: '' });
  for (let i = 0; i < CLIENT_CODE_LIMIT.limit; i += 1) {
    await signInWithProjectCode('owner@example.com', 'BSA-001', d);
  }
  assert.equal((await signInWithProjectCode('owner@example.com', 'BSA-002', d)).result, 'rate_limited');
});

// ── The two states that are NOT a rejection ──────────────────────────────────

test('a revoked homeowner is told so, and gets no session', async () => {
  // Safe to distinguish: they proved the code and the email, so they own the
  // account. Leaving them retyping a code that is right helps nobody.
  const outcome = await signInWithProjectCode('owner@example.com', 'BSA-052', deps({
    store: store({ revoked: true }).store,
  }));
  assert.deepEqual(outcome, { result: 'revoked' });
});

test('an outage is not a rejection', async () => {
  // Reporting a failed read as "wrong code" sends a homeowner to their
  // contractor asking for a code that was right all along.
  const broken: SignedProjectReader = {
    async findSignedProjectForClient() { throw new Error('ECONNRESET'); },
  };
  assert.deepEqual(
    await signInWithProjectCode('owner@example.com', 'BSA-052', deps({ reader: broken })),
    { result: 'unavailable' },
  );

  const brokenStore: ClientAccountStore = {
    async provisionClientFromSignedProject() { throw new Error('hub down'); },
  };
  assert.deepEqual(
    await signInWithProjectCode('owner@example.com', 'BSA-052', deps({ store: brokenStore })),
    { result: 'unavailable' },
  );
});

// ── What the screen says ─────────────────────────────────────────────────────

test('the rejection message names neither half', async () => {
  const message = clientCodeMessage({ result: 'rejected' });
  assert.doesNotMatch(message, /no account|not found|unknown email|wrong code|no such/i);
  // It must still tell a real homeowner where to find the thing they need.
  assert.match(message, /project code/i);
});

test('every outcome has a message except the one that redirects', () => {
  const outcomes: ClientCodeOutcome[] = [
    { result: 'rejected' },
    { result: 'revoked' },
    { result: 'rate_limited', retryAfterSeconds: 900 },
    { result: 'unavailable' },
  ];
  for (const outcome of outcomes) {
    assert.notEqual(clientCodeMessage(outcome), '', `${outcome.result} has no message`);
  }
  assert.equal(
    clientCodeMessage({
      result: 'signed-in',
      membership: { id: 'm', email: 'e', fullName: '', role: 'client', projectIds: [] },
    }),
    '',
  );
});

test('the wait is reported in whole minutes, never in zero', () => {
  assert.match(clientCodeMessage({ result: 'rate_limited', retryAfterSeconds: 1 }), /1 minute\b/);
  assert.match(clientCodeMessage({ result: 'rate_limited', retryAfterSeconds: 3599 }), /60 minutes/);
});
