# Rollback — the GoHighLevel Marketplace install

**What this covers:** getting back to per-sub-account Private Integration
tokens if the Marketplace install misbehaves. Written 2026-09-22, alongside the
change itself.

**The state to return to** is tagged `pre-ghl-oauth`, on `main`, at commit
`e47ea8f`, pushed to both `origin` and `company`. That is the last commit before
any of this existed, and it is a working system: every contractor's API access
runs on `GHL_LOCATION_TOKENS`.

---

## The short version

**Unset `GHL_OAUTH_ENABLED` and redeploy the existing build.** That is the whole
rollback for every fault this change can cause. The new code stays on disk and
does nothing.

Everything below is for the rarer cases.

---

## Why the shallow rollback is enough

The change is additive by construction. `configForLocation()`
(`apps/web/src/lib/ghl/resolve-config.ts`) computes today's answer first —
`withLocationToken`, the per-location PIT — and only replaces it if the
Marketplace install produces something better:

| Situation | What a request uses |
|---|---|
| `GHL_OAUTH_ENABLED` unset | The PIT. Identical to 2026-09-22. |
| Set, but the app is half-configured | The PIT. A typo must not take everyone down. |
| Set, Hub database unreachable | The PIT, with a warning. |
| Set, migration 0016 not run | The PIT, with a warning. |
| Set, app not installed on that sub-account | **That sub-account's own PIT**, with a warning naming the location. |
| Set, install healthy | That sub-account's own token. |

Four tests in `lib/ghl/resolve-config.test.ts` assert those rows, including one
that compares the switched-off result against `withLocationToken` itself rather
than a copied expectation — so if the old path ever changes, the test follows it
instead of going stale.

**This is why the Private Integration tokens stay in place** until the install
is proven on real work. While both exist, a broken install is a line in the log
rather than an outage. Removing them is step 9 of the plan and a separate,
deliberate change.

---

## Level 1 · Turn it off

1. Remove `GHL_OAUTH_ENABLED` (or set it to anything other than `true`) in the
   host's environment variables.
2. **Redeploy.** Environment variables are bound when a deployment is created,
   so the change does not take effect until one is. Use the host's *Redeploy*
   on the current deployment — it reuses the existing build, so no code is
   rebuilt and nothing else changes.

**Undoes:** every credential-resolution effect of this change.
**Leaves behind:** the code (inert), the database table (unread), and the
Marketplace install in GoHighLevel (unused).
**Time:** about a minute, plus the redeploy.

## Level 2 · Take the code out

Only if the new code is itself the problem — a build failure, or something
misbehaving with the flag already off.

```sh
# See exactly what landed
git log --oneline pre-ghl-oauth..main

# Undo those commits, keeping the history honest
git revert --no-commit pre-ghl-oauth..main
git commit -m "Revert the Marketplace install work"
git push origin main && git push company main   # this deploys
```

A `git revert` is preferred over resetting to the tag: `main` is deployed from,
and other work may have landed on top.

**One thing to check before pushing:** this branch is shared. Run
`git log --oneline pre-ghl-oauth..main` and confirm every commit listed is part
of this change and not somebody else's work.

**Undoes:** the code, including the `await`s added at the eight call sites.
**Leaves behind:** the database table and the GoHighLevel install.

## Level 3 · Remove the table

Only if you want the database back exactly as it was. Nothing references this
table, and nothing in it is referenced from anywhere else.

```sql
drop table if exists public.hub_ghl_oauth;
```

**Do not run this while the flag is on** — the app would fall back to the PITs
correctly, but you would be removing the only copy of every sub-account's
refresh token, which means installing on each of them again.

## Level 4 · Uninstall from GoHighLevel

In each connected sub-account, uninstall the app. That invalidates its tokens
immediately.

Do this if an install itself is the problem — wrong sub-account, wrong scopes,
or a credential you believe has been exposed. It is also the correct response to
a leaked client secret, together with rotating the secret on the app — note that
rotating the secret invalidates **every** sub-account's tokens at once, so each
one has to be installed again.

---

## Which level do I need?

| Symptom | Level |
|---|---|
| Invoices or emails failing for one contractor | **None yet.** Check the log for `no Marketplace token for <location>` — that says the app is not installed on their sub-account, and they are already falling back to their PIT. If they have no PIT either, that is the same 401 they had yesterday. |
| Failing for *everyone*, at once | **1.** That points at the app or its secret, not at one install. |
| `refreshed <location> but could not store it` | Install the app on that sub-account again. Two instances refreshed together and the stored refresh token is stale. |
| A build or deploy failure | **2.** |
| Wrong sub-account, or a secret exposed | **4**, then **1**. |
| Just clearing up after abandoning the idea | **1 → 2 → 3 → 4**, in that order. |

## What to grep for in the logs

Every line from this change is prefixed `[ghl-oauth]`, and none of them ever
contains a token:

- `no Marketplace token for <location> — falling back` — expected until the app
  is installed on that sub-account. Once per location per instance.
- `token refresh failed for <location>` — that sub-account is back on its PIT.
- `refreshed X and was given Y — refusing` — should never appear. It means
  GoHighLevel answered for another sub-account and the app threw it away rather
  than storing it.
- `hub_ghl_oauth has no location_id yet — run the migration` — 0016 has not been
  run. Harmless; the app is using PITs.

## How long a fault lasts if you do nothing

A token is cached in each instance's memory, and never trusted for more than
**an hour** however long GoHighLevel says it is good for. So if one dies early —
the app uninstalled from that sub-account, or re-installed — the worst case is
an hour of 401s for that one contractor before the process re-reads the row and
discovers the truth. That is the reason for the cap; the tokens themselves live
about a day.

Level 1 is still faster, and does not wait for anything to expire.

## What is NOT reversible

Nothing in this change alters or deletes existing data. The only one-way door is
a refresh token: once GoHighLevel issues a new one, the previous one is dead. If
a stored copy is lost, the recovery is to install the app on that sub-account
again — one click, breaking nothing, because the PITs are still there.
