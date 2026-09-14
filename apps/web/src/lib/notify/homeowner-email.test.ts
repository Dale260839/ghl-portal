import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildHomeownerEmail } from './homeowner-email.ts';

const base = {
  projectName: 'Michael Drywall repair test 2',
  projectCode: 'BSA-APS-002',
  clientName: 'Michael Test',
  signInUrl: 'https://hub.example/signin',
};

test('an update email carries the client summary, the code and the sign-in link, and nothing else', () => {
  const m = buildHomeownerEmail({
    ...base,
    event: { kind: 'update', clientSummary: 'Drywall hung on the north wall today.', publishDate: '2026-09-14' },
  });
  assert.match(m.subject, /progress update/);
  assert.match(m.html, /Drywall hung on the north wall today\./);
  assert.match(m.html, /BSA-APS-002/);
  assert.match(m.html, /https:\/\/hub\.example\/signin/);
  assert.match(m.html, /Hi Michael,/);
  for (const forbidden of ['internal', 'Internal', 'markup', 'margin', 'cost', 'crew', 'hours']) {
    assert.equal(m.html.includes(forbidden), false, `must not mention ${forbidden}`);
  }
});

test('a change order email states the net figure and the schedule impact, and asks for a decision', () => {
  const m = buildHomeownerEmail({
    ...base,
    event: { kind: 'changeOrder', number: 'CO-1', title: 'Add two outlets', netAmount: 250, scheduleImpactDays: 2 },
  });
  assert.match(m.subject, /CO-1 needs your decision/);
  assert.match(m.html, /\$250/);
  assert.match(m.html, /Schedule impact: 2 days/);
  assert.match(m.html, /approve or decline/);
});

test('a credit reads as a credit, and zero days reads as no change', () => {
  const m = buildHomeownerEmail({
    ...base,
    event: { kind: 'changeOrder', number: 'CO-2', title: 'Smaller vanity', netAmount: -400, scheduleImpactDays: 0 },
  });
  assert.match(m.html, /Credit to you: \$400/);
  assert.match(m.html, /No change to the schedule/);
});

test('a message email quotes the released body and names the author', () => {
  const m = buildHomeownerEmail({
    ...base,
    event: { kind: 'message', author: 'Alliance Pro Services', body: 'Framing inspection is booked for Tuesday.' },
  });
  assert.match(m.subject, /new message from Alliance Pro Services/);
  assert.match(m.html, /Framing inspection is booked for Tuesday\./);
});

test('HTML in user text is escaped, never rendered', () => {
  const m = buildHomeownerEmail({
    ...base,
    event: { kind: 'message', author: 'x', body: '<script>alert(1)</script>' },
  });
  assert.equal(m.html.includes('<script>'), false);
  assert.match(m.html, /&lt;script&gt;/);
});

test('with no project code the code line is omitted rather than printed blank', () => {
  const m = buildHomeownerEmail({
    ...base,
    projectCode: null,
    event: { kind: 'update', clientSummary: 'x', publishDate: '2026-09-14' },
  });
  assert.equal(m.html.includes('project code'), false);
});
