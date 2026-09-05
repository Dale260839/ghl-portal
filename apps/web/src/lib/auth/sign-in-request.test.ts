import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  requestSignInLink,
  signInEmail,
  signInLinkFor,
  signInRequestMessage,
  type SignInRequestDeps,
} from './sign-in-request.ts';
import { createRateLimiter } from './rate-limit.ts';
import { consumeVerificationToken, createMemoryConsumedTokens } from './verification-token.ts';
import type { EmailMessage, EmailResult, EmailSender } from '../email/sender.ts';
import { CONTACTS } from '../data/fixtures.ts';

const SECRET = 'test-secret-at-least-32-characters-long';
const NOW = 1_700_000_000;
const ORIGIN = 'https://hub.example.com';

const johnson = CONTACTS.find((c) => c.id === 'contact-johnson')!;
const whitfield = CONTACTS.find((c) => c.id === 'contact-whitfield')!;

/** Records what was sent, so tests can assert on the message and the absence of one. */
function recorder(result: EmailResult = { delivered: true, id: 'test' }): {
  sender: EmailSender;
  sent: EmailMessage[];
} {
  const sent: EmailMessage[] = [];
  return {
    sent,
    sender: {
      async send(message) {
        sent.push(message);
        return result;
      },
    },
  };
}

function deps(over: Partial<SignInRequestDeps> = {}): SignInRequestDeps {
  return {
    sender: recorder().sender,
    secret: SECRET,
    origin: ORIGIN,
    limiter: createRateLimiter({ limit: 5, windowSeconds: 900 }),
    contacts: CONTACTS,
    now: NOW,
    ...over,
  };
}

test('a real email with its own project sends a link', async () => {
  const rec = recorder();
  const outcome = await requestSignInLink(johnson.email, johnson.projectIds[0]!, deps({ sender: rec.sender }));

  assert.equal(outcome.result, 'sent');
  assert.equal(rec.sent.length, 1);
  assert.equal(rec.sent[0]!.to, johnson.email.toLowerCase());
});

test('C-2 the emailed link is the credential, and it authenticates the contact', async () => {
  const rec = recorder();
  await requestSignInLink(johnson.email, johnson.projectIds[0]!, deps({ sender: rec.sender, jti: 'j1' }));

  const link = rec.sent[0]!.text.split('\n').find((l) => l.startsWith(ORIGIN))!;
  const token = decodeURIComponent(new URL(link).searchParams.get('token')!);

  const out = consumeVerificationToken(token, SECRET, createMemoryConsumedTokens(), { now: NOW + 60 });
  assert.equal(out.valid, true);
  assert.equal(out.valid && out.contactId, 'contact-johnson');
});

test('a miss is INDISTINGUISHABLE from a hit, and sends nothing', async () => {
  const rec = recorder();
  const outcome = await requestSignInLink('stranger@example.com', johnson.projectIds[0]!, deps({ sender: rec.sender }));

  assert.equal(outcome.result, 'sent', 'the outcome must not reveal the miss');
  assert.equal(rec.sent.length, 0, 'but nothing is actually sent');
});

test('a real email with someone else’s project is also a miss', async () => {
  const rec = recorder();
  const outcome = await requestSignInLink(johnson.email, whitfield.projectIds[0]!, deps({ sender: rec.sender }));

  assert.equal(outcome.result, 'sent');
  assert.equal(rec.sent.length, 0);
});

test('a delivery failure is STILL reported as sent, or the failure becomes the oracle', async () => {
  const rec = recorder({ delivered: false, reason: 'provider down' });
  const outcome = await requestSignInLink(johnson.email, johnson.projectIds[0]!, deps({ sender: rec.sender }));

  // It was attempted, and it failed, and the caller cannot tell.
  assert.equal(rec.sent.length, 1);
  assert.equal(outcome.result, 'sent');
});

test('the limit is consumed even on a miss, so guessing is never free', async () => {
  const limiter = createRateLimiter({ limit: 2, windowSeconds: 900 });
  const d = deps({ limiter });

  await requestSignInLink(johnson.email, 'BSA-001', d);
  await requestSignInLink(johnson.email, 'BSA-002', d);
  const third = await requestSignInLink(johnson.email, johnson.projectIds[0]!, d);

  assert.equal(third.result, 'rate_limited', 'two misses must still exhaust the limit');
});

test('rate limiting reports independently of whether anything matched', async () => {
  const limiter = createRateLimiter({ limit: 1, windowSeconds: 900 });
  const d = deps({ limiter });

  await requestSignInLink('stranger@example.com', 'BSA-999', d);
  const out = await requestSignInLink('stranger@example.com', 'BSA-999', d);

  assert.equal(out.result, 'rate_limited');
  assert.equal(out.result === 'rate_limited' && out.retryAfterSeconds, 900);
});

test('the email never echoes the project code back', async () => {
  const rec = recorder();
  const code = johnson.projectIds[0]!;
  await requestSignInLink(johnson.email, code, deps({ sender: rec.sender }));

  assert.ok(!rec.sent[0]!.text.includes(code), 'a forwarded email must not carry half the lookup');
});

test('the email says the link is single-use and expiring', async () => {
  const message = signInEmail('dana@example.com', `${ORIGIN}/auth/verify?token=abc`);
  assert.match(message.text, /once/);
  assert.match(message.text, /15 minutes/);
  assert.match(message.text, /did not ask/);
});

test('the link points at the verify route and survives token encoding', () => {
  const link = signInLinkFor(ORIGIN, 'a+b/c=');
  assert.ok(link.startsWith(`${ORIGIN}/auth/verify?token=`));
  assert.equal(new URL(link).searchParams.get('token'), 'a+b/c=');
});

test('a trailing slash on the origin does not produce a double slash', () => {
  assert.equal(
    signInLinkFor('https://hub.example.com/', 'tok'),
    'https://hub.example.com/auth/verify?token=tok',
  );
});

test('the shown message confirms nothing about existence', () => {
  const message = signInRequestMessage({ result: 'sent' });
  assert.match(message, /If that matches/i, 'it must stay conditional');
});

test('the rate-limited message tells a real person when to come back', () => {
  assert.match(signInRequestMessage({ result: 'rate_limited', retryAfterSeconds: 900 }), /15 minutes/);
  assert.match(signInRequestMessage({ result: 'rate_limited', retryAfterSeconds: 30 }), /1 minute\b/);
});
