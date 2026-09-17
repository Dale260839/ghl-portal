import assert from 'node:assert/strict';
import test from 'node:test';

import { appointmentEmail } from './email.ts';

/**
 * The appointment email (John, 2026-09-17). What matters most is what the
 * homeowner's copy leaves out.
 */

const base = {
  companyName: 'Alliance Pro Services',
  projectReference: 'BSA-053',
  title: 'Framing inspection',
  when: 'Tue, Sep 22, 2026, 9:00 AM – 11:00 AM',
  status: 'Scheduled',
  assigneeLabel: 'Tony Alvarez',
  notes: 'Gate code 4471. Park on the street.',
  openUrl: 'https://hub.example/field',
};

test('the crew member gets the date, the notes and a way in', () => {
  const { subject, html } = appointmentEmail({ ...base, audience: 'crew' });
  assert.match(subject, /Framing inspection/);
  assert.match(subject, /BSA-053/);
  assert.match(html, /Tue, Sep 22, 2026, 9:00 AM/);
  assert.match(html, /Gate code 4471/);
  assert.match(html, /href="https:\/\/hub\.example\/field"/);
});

test('the contractor is told who was tagged', () => {
  const { html } = appointmentEmail({ ...base, audience: 'contractor', openUrl: 'https://hub.example/dashboard/projects/x/schedule' });
  assert.match(html, /added to the schedule for Tony Alvarez/);
  assert.match(html, /Gate code 4471/);
});

test('the homeowner copy never carries the team notes, the crew tag or a link', () => {
  const { subject, html } = appointmentEmail({ ...base, audience: 'homeowner', assigneeLabel: 'Homeowner — Dana Johnson' });
  assert.equal(html.includes('Gate code'), false, 'crew instructions stay with the crew');
  assert.equal(html.includes('Tagged'), false);
  assert.equal(html.includes('href='), false, 'the appointment is internal until released; the portal would show nothing');
  assert.match(subject, /^Alliance Pro Services: Framing inspection/);
  assert.match(html, /BSA-053/);
});

test('an appointment with no date says so rather than printing nothing', () => {
  const { subject, html } = appointmentEmail({ ...base, audience: 'crew', when: null });
  assert.match(subject, /Date to be confirmed/);
  assert.match(html, /Date to be confirmed/);
});

test('whatever the contractor typed is text, not markup', () => {
  const { html } = appointmentEmail({
    ...base,
    audience: 'crew',
    title: '<img src=x onerror=alert(1)>',
    notes: '<script>steal()</script>',
    openUrl: 'https://hub.example/field?a=1&b="2"',
  });
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /href="https:\/\/hub\.example\/field\?a=1&amp;b=&quot;2&quot;"/);
});
