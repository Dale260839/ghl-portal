# Project Hub pilot hardening - 1 October 2026

## Status

Implemented locally on codex/photo-flow-hardening, starting from ded0aed.
Application not deployed. No existing production project records, invoices or
secrets changed. Approved Hub database migrations 0020 and 0021 are now live.
The correct alliance4contractors.com Chrome profile is signed in. Read-only
checks against Project Hub production confirmed migration 0019 on 1 October.
Migration 0020 and the browser TRUNCATE cleanup (0021) were applied and verified
after approval. The application changes remain local.

## Live Database Verification

Checked the existing production Supabase tab for nexpqqxarimqmntnvzff.
The overview reported Healthy at inspection, despite a platform incident banner.
The dashboard's "No migrations" label is not evidence that SQL was never run:
the actual schema confirms the following.

- Migration 0019: hub_photos.update_id exists, with its foreign key to
  hub_daily_updates(id), ON DELETE SET NULL, and the hub_photos_update index.
  The task_id column also exists.
- Migration 0020: hub_upload_budgets, hub_claim_upload and the enabled photo
  guard trigger are installed. All 12 initial post-migration checks passed,
  including anonymous/authenticated RPC and budget-table denial.
- All 23 Hub tables now have RLS enabled. No Hub row policies or anonymous table
  grants were found. Migration 0021 removed browser TRUNCATE grants from the 20
  affected tables; service-role photo read/write privileges were preserved.
  Ordinary authenticated grants were not changed. RLS alone must not be
  presented as a replacement for least-privilege grants.
- hub-media is private, with a 52,428,800-byte bucket limit and an explicit MIME
  allowlist. No storage row policies were found. The proposed 3.5 MB application
  limit is separate from this existing bucket setting and is not deployed.
- One photo exists, with no update link. No mismatched or archived-update links
  were found, but zero linked photos means the real end-to-end photo test is
  still required. client_visible defaults to false and is NOT NULL.
- Live service-role quota tests passed: 60 hourly attempts, 3.5 MB file cap,
  tenant-wide daily bytes, and counter rollback on refusal. Synthetic writes
  were rolled back and no test budget rows remained.
- Live service-role photo tests passed: valid same-project linking, rejection
  of cross-project links, rejection of replacement with another update and
  rejection of cross-project photo moves. All synthetic photos/updates were
  rolled back. These are database checks, not the full real-user pilot.
- Screenshots: PROJECT-HUB-0020-LIVE-VERIFICATION-2026-10-01.png and
  PROJECT-HUB-PHOTO-GUARDS-LIVE-2026-10-01.png in the Desktop/chris workspace.

## Changes

- Production no longer creates a contractor session from an unsigned location URL.
  Signed bridge links require a user, a timestamp and a matching signature.
  Their field values are URL-encoded before signing. Existing unsigned GHL
  session cookies are rejected after this release.
- Added Marketplace encrypted user-context sign-in. The server decrypts the
  context, checks the configured agency and active location, and scopes the
  session through BuildSuite profiles for that location. Shared secrets stay
  server-side. Embedded sessions use Secure, HttpOnly, partitioned cookies.
- Operator controls additionally require verified GHL user identity and an
  admin role, or an explicit ADMIN_GHL_USER_IDS allowlist, plus the existing
  ADMIN_LOCATION_IDS restriction.
- Both file lookup modes now check live membership, current role, read grants,
  active metadata, project assignment and document folders before signing.
- Retry pauses and queued manual retries count as in flight. The project is
  captured when a photo is chosen and stays locked while photos are on the form.
- Photo linking verifies the target update's tenant and project; filters out
  archived, cross-project and already-linked photos. Migration 0020 adds the
  same cross-record rules as database triggers.
- Drafts use per-user/per-tenant keys in tab session storage, expire after one
  day, validate the restored project and clear on successful filing or sign-out.
  Legacy browser-wide drafts are removed.
- All three stored-file upload paths share an atomic database reservation:
  60 attempts per person per fixed hour, 500 MB attempted bytes per contractor
  per UTC day, and 3.5 MB per file (within the existing server-action body cap).
  Failed attempts consume quota too. This is not a lifetime storage quota or
  a plan entitlement system; retention and plan-specific caps remain separate.
- Added basic loop protection to homeowner messages and issues; cheap-write
  limits remain per-instance and are not advertised as hard cost ceilings.
- Contractor message/file actions reject crew attempts to publish through
  contractor-only entry points, and relevant writes use live membership.
- Updated Next.js within v15 and patched transitive dependencies. PostCSS has
  an override because Next v15 still pins its old version.

## Evidence

- Web unit/regression tests, including actual PostgreSQL-compatible migration
  execution in PGlite and quota/trigger/privilege checks.
- 1,239 web tests pass after adding the TRUNCATE regression test.
- All 40 shared-contract tests pass.
- Workspace TypeScript checks and production build.
- scripts/test-field-ui.mjs mounts the real React uploader/draft/submit components.
  It tests automatic backoff, terminal failure, manual retry, project identity
  and shared-browser draft isolation.
- scripts/test-pilot-pages.mjs targets a loopback-only isolated test server.
  It tests unsigned login even with a configured API credential, forged POST
  origin, revoked invited-contractor file access, sign-out, and field/homeowner
  rendering. Mobile and desktop screenshots are in ignored .artifacts/.
- scripts/test-ghl-iframe.mjs mounts the real Connecting component in a
  cross-origin iframe. The request/response handshake, origin refusal,
  malformed-context timeout and preservation of signed identity fields pass.
  Backend responses are fixtures; this does not verify live GHL installation.
- npm audit reports zero vulnerabilities after dependency patches.
- These checks use synthetic identities, fixture data and a local test secret.
  They are not evidence that the production database or real GHL SSO is ready.

## Deployment Access

The existing repository credential confirmed the main deployment is still
ded0aed0ba1552c038af88912402b31d2170c9d8, with a successful Vercel status at:
https://vercel.com/allianceforcontractors-2450s-projects/project-hub/6PuTcgdXZjd2r4uvcJjKTtwK6AGR

The Work Chrome Vercel tab showed the Dale account with Not Found for that
project, then returned to login. Access to the owning team's environment
settings is not yet verified. Do not promote the hardened app to production
until its authenticated GHL entry point is configured and checked.

## Required Cutover

Do not deploy this branch over the existing unsigned menu login until a working
replacement is configured. Otherwise it will intentionally refuse that login.

1. Migration 0019 is verified in Hub production. Keep its existing column,
   foreign key and index; no rerun is needed.
2. Migrations 0020 and 0021 are applied and verified in the Hub database only.
   Do not run them in BuildSuite or disable RLS. The live application's upload
   paths do not call the new budget RPC until the matching app release deploys.
3. Configure a HighLevel Marketplace Custom Page for /auth/ghl with the location
   parameter. A plain top-level menu URL cannot request encrypted parent context.
4. Set GHL_APP_SHARED_SECRET and GHL_SSO_COMPANY_ID server-side in Vercel.
   Configure GHL_PARENT_ORIGINS for the exact HTTPS CRM/white-label origins.
   The defaults include app.gohighlevel.com and app.allianceforcontractors.com.
   Set ADMIN_GHL_USER_IDS if operator access should be restricted to named users.
5. Verify SSO in a preview deployment and inside the real GHL iframe, including
   cookies, sign-out, account switching and role switching. Verify a contractor
   cannot select a different tenant in the submitted context.
6. Run the real pilot: crew uploads a photo and daily update, PM receives the
   notification, reviews the update, releases chosen photos, and the homeowner
   sees only released content. Test revocation and another project's file links.
7. Verify the existing APS test invoice draft without sending it. Payments still
   require the configured GHL gateway; do not record test payments on real jobs.
8. Deploy only after these live checks pass and release approval is confirmed.

Official protocol reference:
https://marketplace.gohighlevel.com/docs/2021-07-28/other/user-context-marketplace-apps/index.html

CryptoJS is used server-side solely for compatibility with HighLevel's documented
encrypted payload format, not to invent a new encryption scheme.

## Rollback

Do not roll back to unsigned production login. If SSO fails, leave contractor
sign-in closed and fix the configuration or deploy the previous release with
that insecure entry point disabled. Migration 0020 is additive; leave it in place.
Do not roll back by granting anon database access or making hub-media public.
