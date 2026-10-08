import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GROUPS_COOKIE,
  SIDEBAR_COOKIE,
  foldedGroupsCookie,
  isCollapsed,
  parseFoldedGroups,
  sidebarCookie,
} from './sidebar-state.ts';

/**
 * The collapsed-sidebar preference.
 *
 * Small, but it is read during the server render, which is the only reason it
 * is a cookie at all — so the parsing has to survive whatever a browser hands
 * back, including nothing.
 */

test('§ anything other than "collapsed" leaves the sidebar open', () => {
  // A new contractor meets labels, not sixteen unexplained icons. An
  // unreadable value is not a reason to hide every word on the screen.
  assert.equal(isCollapsed(undefined), false);
  assert.equal(isCollapsed(null), false);
  assert.equal(isCollapsed(''), false);
  assert.equal(isCollapsed('expanded'), false);
  assert.equal(isCollapsed('true'), false);
  assert.equal(isCollapsed('1'), false);
  assert.equal(isCollapsed('COLLAPSED'), false, 'exact match, not a guess at case');
});

test('collapsed is honoured, including with the whitespace a cookie can carry', () => {
  assert.equal(isCollapsed('collapsed'), true);
  assert.equal(isCollapsed(' collapsed '), true);
});

test('§ the written cookie round-trips through its own reader', () => {
  // The pair has to agree. A serialiser and a parser that disagree produce a
  // preference that never sticks and nothing that says why.
  for (const collapsed of [true, false]) {
    const written = sidebarCookie(collapsed);
    const value = written.slice(`${SIDEBAR_COOKIE}=`.length).split(';')[0]!;
    assert.equal(isCollapsed(value), collapsed);
  }
});

test('§ it is scoped to the whole site, remembered, and never cross-site', () => {
  // Path=/ because the sidebar is on every screen; a cookie scoped to the page
  // it was toggled on would forget itself on the next click.
  const written = sidebarCookie(true);
  assert.match(written, /Path=\//);
  assert.match(written, /SameSite=Lax/);
  assert.match(written, /Max-Age=31536000/);
});

test('§ it is not, and must not become, the session cookie', () => {
  // It is written by the browser, so it is forgeable by whoever is sitting
  // there. Keeping it under its own name is what stops a display preference
  // ever being mistaken for something the server may trust.
  assert.equal(SIDEBAR_COOKIE, 'hub_sidebar');
  assert.doesNotMatch(sidebarCookie(true), /HttpOnly/i);
});

// ── Folded headings ─────────────────────────────────────────────────────────

test('§ no cookie means every heading is open', () => {
  // Storing the CLOSED ones is the whole design. Store the open ones and a
  // heading added later arrives folded for everybody who ever touched the
  // control — which is how a section ships and nobody finds it.
  assert.deepEqual(parseFoldedGroups(undefined), []);
  assert.deepEqual(parseFoldedGroups(null), []);
  assert.deepEqual(parseFoldedGroups(''), []);
});

test('§ headings round-trip, including the one with a space in it', () => {
  // "Project Information" is why this is not comma-separated and why it is
  // URI-encoded: a cookie value cannot carry whatever it likes.
  const groups = ['Project Information', 'Financial'];
  const written = foldedGroupsCookie(groups);
  const value = written.slice(`${GROUPS_COOKIE}=`.length).split(';')[0]!;
  assert.deepEqual(parseFoldedGroups(value), groups);
});

test('a repeated or blank heading is not a heading', () => {
  assert.deepEqual(parseFoldedGroups('Work~Work~~ Work '), ['Work']);
  assert.deepEqual(parseFoldedGroups('~~~'), []);
  assert.deepEqual(parseFoldedGroups(foldedGroupsCookie(['Work', 'Work']).split('=')[1]!.split(';')[0]!), ['Work']);
});

test('§ it is scoped and remembered like the width beside it', () => {
  const written = foldedGroupsCookie(['Work']);
  assert.match(written, /Path=\//);
  assert.match(written, /SameSite=Lax/);
  assert.match(written, /Max-Age=31536000/);
  assert.notEqual(GROUPS_COOKIE, SIDEBAR_COOKIE, 'two preferences, two cookies');
});
