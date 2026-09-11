import assert from 'node:assert/strict';
import test from 'node:test';

import { portalHref } from './portal-link.ts';

/**
 * Portal links stay on the project being shown.
 *
 * Chris, huddle 2026-09-10: "keep the preview mode seamless". The nav dropped
 * `?preview=` and `?project=`, and the portal's fallback is the FIRST project —
 * so a contractor previewing job B was shown job A's client view on the next
 * click, and a homeowner with two jobs was put back on the first.
 */

const q = (s: string) => new URLSearchParams(s);

test('a previewing contractor stays on the project they are previewing', () => {
  assert.equal(portalHref('/portal/schedule', q('preview=p-b')), '/portal/schedule?preview=p-b');
  assert.equal(portalHref('/portal', q('preview=p-b')), '/portal?preview=p-b');
});

test('a homeowner with two jobs stays on the one they picked', () => {
  // §1.4 — a contact may hold several projects.
  assert.equal(portalHref('/portal/timeline', q('project=job-2')), '/portal/timeline?project=job-2');
});

test('both are carried when both are present', () => {
  const href = portalHref('/portal/designs', q('preview=p-b&project=job-2'));
  const params = new URL(href, 'https://hub.example').searchParams;
  assert.equal(params.get('preview'), 'p-b');
  assert.equal(params.get('project'), 'job-2');
});

test('nothing else in the address is carried', () => {
  // Only the two parameters that choose a project. A filter or an error
  // message on one screen has no business following someone to the next.
  assert.equal(
    portalHref('/portal/schedule', q('preview=p-b&error=boom&view=all')),
    '/portal/schedule?preview=p-b',
  );
});

test('a bare portal visit is left bare', () => {
  // The ordinary homeowner with one job: no parameters, no change.
  assert.equal(portalHref('/portal/schedule', q('')), '/portal/schedule');
  assert.equal(portalHref('/portal/schedule', null), '/portal/schedule');
  assert.equal(portalHref('/portal/schedule', q('preview=')), '/portal/schedule');
  assert.equal(portalHref('/portal/schedule', q('preview=%20%20')), '/portal/schedule');
});

test('non-portal links are never touched', () => {
  // The same nav component renders the contractor and field shells.
  for (const href of ['/dashboard', '/dashboard/projects', '/field/tasks', '/portals', '/portalx/a']) {
    assert.equal(portalHref(href, q('preview=p-b&project=job-2')), href, href);
  }
});

test('a link that already names a project keeps its own', () => {
  // The portal home lists a homeowner's jobs as `/portal?project=<id>` links.
  // Those deliberately point at a DIFFERENT project and must not be overwritten
  // by the one currently on screen.
  assert.equal(
    portalHref('/portal?project=job-3', q('project=job-2')),
    '/portal?project=job-3',
  );
});

test('a carried value is encoded, not pasted', () => {
  // The value came from the address bar. It reaches the next URL as a
  // parameter, never as extra syntax.
  const href = portalHref('/portal/schedule', q('preview=a%26evil%3D1'));
  const params = new URL(href, 'https://hub.example').searchParams;
  assert.equal(params.get('preview'), 'a&evil=1');
  assert.equal(params.has('evil'), false);
});
