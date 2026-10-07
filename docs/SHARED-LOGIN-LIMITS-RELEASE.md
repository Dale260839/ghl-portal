# Shared Login Limits

Prepared October 7, 2026. This is a separate release from PR #7.

## Status

Implemented on `codex/shared-login-limits`; not installed in the production database or deployed.
Do not merge/deploy the application change before migration 0022 is verified.
The current production release remains 453a17f.

## What Changes

- Password and homeowner-code attempts use an atomic Hub database counter across
  Vercel instances, rather than a separate in-memory allowance on each server.
- Limits remain five code attempts/hour and ten password attempts/15 minutes,
  enforced independently by normalized email and caller IP. Code-shaped passwords
  retain the stricter code limit before password fallback.
- Database time sets the window. Browser/client timestamps cannot refresh it.
- Only keyed hashes of email/IP keys are stored, not raw emails or IP addresses.
- Successful sign-ins now count too. They do not refund the shared IP/account
  allowance. People sharing an IP share that path's budget; monitor this during
  the controlled pilot before choosing a less restrictive, separately reviewed
  IP policy. Do not weaken the per-account limit.
- Missing migration, invalid responses, database errors and timeouts refuse new
  credential sign-ins with a retry message. There is no memory fallback or write
  retry. GHL sign-in and already-authenticated sessions are not changed.
- A password-lookup database error now returns a recoverable sign-in refusal
  instead of throwing an unhandled page error.

## Release Order

1. Review and run `supabase/hub/0022_shared_login_limits.sql` on the **Hub**
   database only. Never run this on BuildSuite. It creates an isolated counter
   table and server-only RPC; it changes no project, membership or password.
2. Verify the actual RPC as the service role using synthetic hashed keys: five
   code claims allowed, sixth refused; equivalent password budget ten/eleven.
   Verify anon/authenticated cannot read, write, reset or execute the counters.
3. Test parallel calls through separate PostgreSQL connections before rollout.
   Local PGlite tests queue queries and do not prove multi-connection lock behavior.
4. Deploy the tested branch/commit and confirm Vercel Production Ready and Current.
5. Check existing crew and homeowner sign-ins, wrong-role redirects and sign-out
   on Test Project. Inspect the same request window for limiter/auth errors.
6. Use synthetic accounts/keys for deliberate limit exhaustion. Do not lock out
   Chris, Dale or any real client to test the threshold.

If application verification fails, return to the previously verified deployment.
The unused counter table can remain; no destructive rollback or RLS changes are
needed. Such an application rollback also restores the prior in-memory limiter
weakness, so retain the controlled-pilot restriction.

## Tests

- SQL ceiling/window/role checks use the actual migration in isolated PGlite.
- Independent limiter instances call the same SQL counter through a fake HTTP
  transport; the second instance cannot reset the first instance's budget.
- Malformed responses, missing migration, timeouts, outage UI and server wiring
  have focused coverage. Full web suite, typecheck and production build are also
  required before release.
- Verified October 7: 1,424 web tests, 40 contract tests, 12 sign-in-page checks,
  18 invitation/access checks, typecheck and production build passed.

## Still Open

- Invitation/password-reset redemption needs one database transaction to prevent
  two simultaneous uses of the same token changing the password twice.
- Password resets need to invalidate existing sessions.
- Expired partitioned-cookie cleanup needs a separate regression check.
- Sequential project codes remain weak credentials even with a shared limiter.
  Stronger homeowner authentication needs its own product decision and rollout.
- The current five-row active-membership lookup still needs a deliberate
  multi-workspace design for people with more than five active memberships.

## Live PR #7 Checks Today

- Fresh GHL PM, real homeowner and real crew sign-ins passed on production 453a17f.
- Homeowner saw Test Project and three published photos, not the private PM
  marker or hidden budget. All three photos decoded at 960 x 640.
- Crew opened the existing pilot task and two attached photos, returned to the
  task list and selected Test Project in the daily-update form without submitting.
- Direct PM-dashboard requests from crew/homeowner returned to their own surfaces.
- Homeowner sign-out blocked a subsequent portal request. Crew was left signed in.
- No new updates/photos, task-status edits, invitations or password resets.
- Observed usability follow-up: homeowner dashboard says `Last updated Sep 9`
  while showing an Oct 6 recent update, and `Up next Sep 18` is in the past.
  Investigate source/meaning of these labels; do not treat them as current activity.

These read-only checks are not a new crew-to-PM publication test or a load test.
