# BuildSuite API, Integration Reference

**For:** Juan Carlo
**From:** Sing
**Base URL:** `https://api.buildsuite.ai/api/v1`
**Generated from source**, not from memory. Every endpoint below was read out of the FastAPI route
modules and independently verified. 136 route decorators exist across 20 modules; 130 are live
(`chat.py` is commented out in `app/api/routes.py`).

Interactive docs are also live and always current:

- Swagger UI: `https://api.buildsuite.ai/docs`
- OpenAPI JSON: `https://api.buildsuite.ai/api/v1/openapi.json`

The OpenAPI spec is the machine-readable source of truth for request and response shapes. This
document exists for the things a spec cannot tell you: which id belongs where, which endpoints are
broken, and which ones will bite you.

---

## 1. Read this first: there is no machine authentication

**Every authenticated endpoint requires a session cookie named `bs_session`.** It is an HTTP-only
JWT issued only through the GoHighLevel login flow. There is:

- no API key
- no bearer token
- no service account
- no client credentials flow

So a server-to-server integration **cannot call this API today**. Options, cheapest first:

1. **Proxy the user's session.** Your portal runs in the browser on a `.buildsuite.ai` subdomain,
   the cookie is sent automatically (`COOKIE_DOMAIN=.buildsuite.ai`), and you call the API as that
   user with their own permissions. No backend work on our side.
2. **A scoped service token.** I add a header-based token with an explicit endpoint allowlist.
   Roughly half a day to a day. Tell me exactly which endpoints you need and I scope it to those.

Pick one before writing integration code, because it changes the shape of everything else.

**CORS is restricted** to `https://www.buildsuite.ai` and `https://buildsuite.ai`. A browser-based
portal on any other origin will be blocked until your origin is added.

---

## 2. The id problem. This is the single biggest trap in the API

There are **four different id spaces** in play and they are not interchangeable. Passing the wrong
one usually produces a silent 403 or an empty result rather than a clear error.

| Id | What it is | Where you get it |
|---|---|---|
| `contractors.id` | contractors table primary key, a UUID | `GET /contractors/` rows |
| **GHL contact id** | GoHighLevel's contact identifier, **not** a UUID | `GET /auth/me` returns this as `id` |
| `auth_profiles.id` | the login identity, a UUID | `GET /auth/me` as `auth_profile_id` |
| `projects.id` / `deals.id` | table primary keys, UUIDs | list endpoints |

**The one that catches everyone:** for a contractor, the `id` on the object returned by
`GET /auth/me` is the **GHL contact id**, not `contractors.id`. `PUT /contractors/{contractor_id}`
takes that GHL contact id in the path and resolves the real row internally via
`contractors.ghl_contact_id`. Other endpoints take the actual UUID. Read each endpoint's notes.

**Three consequences you will hit:**

- `GET /projects/prospects` returns items whose `id` and `user_id` are **GHL contact ids**. Passing
  one to `GET /projects/{project_id}` returns 404.
- `GET /projects/feed` returns a **mixed array**. Items with `source == "db"` carry `projects.id`.
  Items with `source == "ghl_opportunity"` carry a GHL **opportunity** id. Only the former work on
  `/projects/{project_id}`. Always branch on `source`.
- `POST /projects/{project_id}/proposal/generate` has a required query param named `contractor_id`
  which is actually an **`auth_profiles.id`**, despite the name.

---

## 3. Roles and permissions

Four roles exist: `client`, `contractor`, `admin`, `affiliate`. Most endpoints check the role
inline rather than via the permission system, so the permission matrix is only part of the picture.

| Permission | client | contractor | admin |
|---|---|---|---|
| `PROJECT_READ_ALL` | | yes | yes |
| `CONTRACTOR_READ` (browse all contractors) | yes | **no** | yes |
| `CONTRACTOR_READ_OWN` / `CONTRACTOR_UPDATE_OWN` | | yes | yes |
| `SUBCONTRACTOR_READ` | | yes | yes |
| `PROPOSAL_CREATE` / `_READ_OWN` / `_UPDATE_OWN` / `_DELETE_OWN` | | yes | yes |
| `PROFILE_READ_OWN` / `PROFILE_UPDATE_OWN` | yes | yes | yes |

`affiliate` holds no contractor permissions at all.

**Admin preview override.** When the caller is an admin, `get_current_user` reads a
`?preview_user_type=` query parameter and mutates the request's role before the handler runs. So an
admin can call any role-gated endpoint by appending `?preview_user_type=contractor`. Useful for
testing, worth knowing exists.

---

## 4. Error shapes

Standard FastAPI: `{"detail": "..."}` with the status code.

**Plan-limit errors are different.** They return **403** with a dict detail:

```json
{
  "detail": {
    "code": "PLAN_LIMIT_PROPOSALS",
    "message": "...",
    "current": 5,
    "limit": 5,
    "remaining": 0,
    "reset_at": "2026-09-01T00:00:00Z",
    "upgrade_url": "..."
  }
}
```

Note the keys are `current` and `limit`, not `current_usage` and `max_limit`.

**Trailing slashes matter.** List and create endpoints are declared as `/`, so the real paths are
`/api/v1/projects/` and `/api/v1/deals/` **with** the slash. Without it you get a 307 redirect, and
some HTTP clients silently downgrade a redirected POST.

---

## 5. Do not use these

Verified broken or unsafe. Avoid them entirely.

| Endpoint | Problem |
|---|---|
| `POST /auth/set-role` | **Completely broken.** Uses `.update().eq().select()`, which raises `AttributeError` on the pinned postgrest 2.26.0. Returns 500, role is never written. |
| `PUT /projects/{project_id}` | Compares a GHL contact id against a UUID column, so it returns **403 for every non-admin caller**. Effectively dead. |
| `POST /projects/{project_id}/delete` | Same broken comparison. Admin only in practice. |
| `GET /projects/health` | Declared after `GET /{project_id}`, so it is shadowed and unreachable. Do not use as a liveness probe. Use `GET /health` or `GET /deals/health`. |
| `POST /users/` | Non-functional, and completely unauthenticated. |
| `POST /deals/{deal_id}/proposal/submit` | Deprecated. |

**Status values are UPPERCASE.** `DealProposalStatus` serializes as `PROCESSING`, `COMPLETED`,
`FAILED`. Branching on `'completed'` will never match.

---

## 6. What you probably want for the project management portal

Based on what you described, these four are the relevant reads:

| Endpoint | Returns |
|---|---|
| `GET /projects/my-projects` | The calling contractor's own projects, paginated, with linked SOW and proposal state |
| `GET /projects/` | Marketplace projects, paginated, with status/trade/radius filters |
| `GET /projects/feed` | Marketplace projects merged with the caller's GHL opportunities, with match scores |
| `GET /deals/me` | The caller's deals from the SOW and proposal flow |

**Two behaviours to know about before you build on them.**

`GET /projects/` **has a write side effect.** For contractors it calls
`increment_usage(user_id, 'projects_visible', N)` on every call, so a plain list request burns plan
quota. Polling it will exhaust a contractor's allowance.

`GET /projects/` and `GET /projects/feed` **both exclude contractor-created projects**
(`source != 'contractor'`). Projects made through `POST /projects/my-projects` only ever appear in
`GET /projects/my-projects`.

---

## 7. Full endpoint reference

Grouped by module. `Auth` is the actual dependency on the route.

## auth-users

| Method | Path | Auth | Summary |
|---|---|---|---|
| GET | `/api/v1/auth/ghl_auth_callback` | NONE (this is the login entrypoint). The only credential is  | THE ONLY WAY A SESSION IS CREATED. GHL Custom Menu Link landing point: validates the location, resolves or aut |
| GET | `/api/v1/auth/ghl_callback` | NONE. Possession of a valid GHL authorization code is the on | GHL Marketplace OAuth callback for AGENCY-level setup. Exchanges the authorization code for agency tokens and  |
| POST | `/api/v1/auth/logout` | NONE - no dependency, no cookie required. Anyone can call it | Clears the bs_session cookie and the two legacy cookies, then 302-redirects to /registration-required. |
| GET | `/api/v1/auth/me` | Manual JWT decode via _extract_auth_profile_id(request) - do | Returns the current session's identity, the live GHL contact record, and the plan/usage summary. This is the e |
| POST | `/api/v1/auth/set-role` | Manual JWT decode via _extract_auth_profile_id(request) (lin | Sets auth_profiles.user_type to contractor or client after first login when the role could not be auto-detecte |
| POST | `/api/v1/users/` | NONE. No cookie, no signature check, no shared secret - a fu | Intended to create an auth_profile from a GHL workflow webhook payload. As written it is non-functional and ne |

## projects

| Method | Path | Auth | Summary |
|---|---|---|---|
| GET | `/api/v1/projects/ (trailing slash; /api/v1/projects 307-redirects)` | get_current_user. No explicit role guard; clients are auto-s | Paginated list of database projects with status/trade/radius filters and contractor plan gating. |
| POST | `/api/v1/projects/ (trailing slash; /api/v1/projects 307-redirects)` | get_current_user, then inline check: role must be exactly Us | Client-only project creation via multipart form with optional image uploads. |
| GET | `/api/v1/projects/feed` | get_current_user (401 without bs_session). No role guard, bu | Unified feed merging database projects with the caller's GHL sub-account opportunities, with contractor match  |
| GET | `/api/v1/projects/health` | none declared on the function itself, but see notes — it is  | Intended liveness probe for the projects service. |
| GET | `/api/v1/projects/my-projects` | get_current_user + _require_contractor() (403 'Only contract | Lists the calling contractor's own projects (source='contractor'), enriched with linked SOW deal and proposal  |
| POST | `/api/v1/projects/my-projects` | get_current_user + _require_contractor() | Creates a contractor project in draft status and optionally provisions a GHL contact. |
| DELETE | `/api/v1/projects/my-projects/{project_id}` | get_current_user + _require_contractor() | Hard-deletes a contractor project plus its storage objects. |
| GET | `/api/v1/projects/my-projects/{project_id}` | get_current_user + _require_contractor() | Fetch one contractor-owned project by id with ownership enforcement. |
| PUT | `/api/v1/projects/my-projects/{project_id}` | get_current_user + _require_contractor() | Partial update of a contractor project; only supplied fields change. |
| POST | `/api/v1/projects/my-projects/{project_id}/clone` | get_current_user + _require_contractor() | Duplicates a contractor project as a new draft, stripping client info, GHL links and attachments. |
| POST | `/api/v1/projects/my-projects/{project_id}/documents` | get_current_user + _require_contractor() | Uploads one or more documents to a contractor project and appends their metadata. |
| DELETE | `/api/v1/projects/my-projects/{project_id}/documents/{index}` | get_current_user + _require_contractor() | Removes one document from a contractor project's documents array by its zero-based position. |
| POST | `/api/v1/projects/my-projects/{project_id}/generate-proposal` | get_current_user + _require_contractor() | Synchronously generates an AI proposal for a contractor project, renders PDF and DOCX, uploads both, and inser |
| POST | `/api/v1/projects/my-projects/{project_id}/images` | get_current_user + _require_contractor() | Uploads one or more images to a contractor project and appends their public URLs. |
| DELETE | `/api/v1/projects/my-projects/{project_id}/images/{index}` | get_current_user + _require_contractor() | Removes one image from a contractor project's images array by its zero-based position. |
| GET | `/api/v1/projects/my-projects/{project_id}/scope` | get_current_user + _require_contractor() | Returns the previously generated SOW for a contractor project as JSON, PDF or DOCX. |
| POST | `/api/v1/projects/my-projects/{project_id}/scope` | get_current_user + _require_contractor() | Generates a structured Scope of Work for a contractor project via LLM, renders a PDF, uploads it, and persists |
| POST | `/api/v1/projects/my-projects/{project_id}/scope/feedback` | get_current_user + _require_contractor() | Records approve/disapprove feedback on a generated SOW and scores the associated Langfuse trace. |
| PATCH | `/api/v1/projects/my-projects/{project_id}/status` | get_current_user + _require_contractor() | Transitions a contractor project's status with state-machine validation and plan-limit enforcement on activati |
| GET | `/api/v1/projects/prospects` | get_current_user, then an inline check: role must be UserRol | Lists GHL contacts tagged 'client_program' as prospect cards, normalized into a project-feed shape with custom |
| GET | `/api/v1/projects/{project_id}` | get_current_user. Only clients are ownership-checked; contra | Fetches a single project by id. |
| PUT | `/api/v1/projects/{project_id}` | get_current_user, then an ownership check that is broken (se | Updates a marketplace project's fields. |
| GET | `/api/v1/projects/{project_id}/contact` | get_current_user, then inline check: user_type must be 'cont | Returns the client contact details for any project, with GHL fallback lookup. |
| POST | `/api/v1/projects/{project_id}/delete` | get_current_user, then owner-or-admin check | Hard-deletes a marketplace project (POST, not DELETE). |
| GET | `/api/v1/projects/{project_id}/documents` | get_current_user. Client must own the project via _project_o | Lists documents-table rows for a project with freshly minted public URLs. |
| POST | `/api/v1/projects/{project_id}/documents` | get_current_user. Client must own the project via _project_o | Uploads a single project document into the documents TABLE with mime/extension validation and per-plan storage |
| DELETE | `/api/v1/projects/{project_id}/images` | get_current_user. Client must own the project via _project_o | Removes one image from a marketplace project's images array, identified by its full URL. |
| POST | `/api/v1/projects/{project_id}/images` | get_current_user. Clients must own the project (auth_profile | Appends additional images to an existing marketplace project, enforcing the plan's per-project image cap. |
| GET | `/api/v1/projects/{project_id}/matches` | NONE. There is no Depends at all on this route. Fully public | Returns all contractor matches for a project, ranked by score. |
| POST | `/api/v1/projects/{project_id}/proposal/generate` | NONE. No Depends, no current_user. Fully public, intentional | Queues asynchronous AI proposal generation for a project on behalf of a contractor and returns immediately for |
| POST | `/api/v1/projects/{project_id}/proposal/submit` | NONE. No Depends, no current_user. Fully public. | Sends an already-generated proposal PDF to the client for e-signature via Adobe Sign and records the tracking  |
| GET | `/api/v1/projects/{project_id}/proposals/{proposal_id}` | get_current_user, then role must equal 'client' (UserRole is | Fetches one proposal scoped to a project, enriched with contractor identity. |
| POST | `/api/v1/projects/{project_id}/reveal` | get_current_user, then inline check: user_type must be 'cont | Spends one plan reveal credit to unlock a project's client contact details, idempotently. |
| POST | `/api/v1/projects/{project_id}/scope` | NONE. No Depends, no current_user. Fully public. | Generates a free-form Scope of Work document for any project and returns it as a downloadable PDF or DOCX. |

## deals

| Method | Path | Auth | Summary |
|---|---|---|---|
| POST | `/api/v1/deals/ (note the trailing slash)` | get_current_user (401 if no bs_session cookie) | Create a deal, link it to the caller's auth profile, and return the access token plus the first intake questio |
| GET | `/api/v1/deals/health` | NONE | Liveness probe for the deals router. |
| GET | `/api/v1/deals/me` | get_current_user (401 if no cookie) | List the authenticated user's own deals, newest-updated first. |
| GET | `/api/v1/deals/sub-services/{project_type}` | NONE — no dependency at all, fully public | Return the selectable sub-services (e.g. cabinets, countertops) for a project type, for the accordion UI on th |
| DELETE | `/api/v1/deals/{deal_id}` | get_current_user (401 if no cookie). Explicitly no token pat | Soft-delete a deal by stamping deleted_at. |
| GET | `/api/v1/deals/{deal_id}` | get_current_user_optional + optional ?token=. Cookie wins ov | Fetch a deal's public-facing summary including coverage progress and photo analysis. |
| POST | `/api/v1/deals/{deal_id}/answers` | get_current_user_optional + optional ?token= | Submit one intake answer, recompute coverage, and get the next question or the scope-ready flag. |
| POST | `/api/v1/deals/{deal_id}/contact` | get_current_user_optional + optional ?token= | Attach client contact details to the deal and mark it proposal_sent. |
| GET | `/api/v1/deals/{deal_id}/contractor-verify` | get_current_user_optional + optional ?token= | Validate a contractor's access to a deal and return the contractor-facing deal view. |
| GET | `/api/v1/deals/{deal_id}/find-contractors` | get_current_user_optional + optional ?token= | Return up to 3 matching contractors for the deal, ranked by confidence. |
| GET | `/api/v1/deals/{deal_id}/house-intelligence` | get_current_user_optional + optional ?token= | Server-side proxy for Dale's House Intelligence API — era/vintage inspection flags for the property. |
| POST | `/api/v1/deals/{deal_id}/material-takeoff` | get_current_user_optional + optional ?token= | Server-side proxy for Dale's Material Takeoff API — derives a materials list from the generated proposal, or f |
| GET | `/api/v1/deals/{deal_id}/next-question` | get_current_user_optional + optional ?token= | Peek at the next intake question without submitting an answer (used to resume a session). |
| POST | `/api/v1/deals/{deal_id}/photos` | get_current_user_optional + optional ?token= | Upload up to 5 site photos, store them publicly, run GPT-4o Vision analysis, and award a coverage bonus. |
| GET | `/api/v1/deals/{deal_id}/progress` | get_current_user_optional + optional ?token= | Coverage-progress snapshot for the intake progress bar. |
| GET | `/api/v1/deals/{deal_id}/proposal` | get_current_user_optional + optional ?token= | Read the latest saved proposal for a deal without triggering generation. |
| PUT | `/api/v1/deals/{deal_id}/proposal` | get_current_user_optional + optional ?token= | Replace the proposal's markdown after inline editing and re-render the PDF and DOCX. |
| POST | `/api/v1/deals/{deal_id}/proposal/cancel-signature` | get_current_user_optional + optional ?token= | Cancel the outstanding Adobe Sign agreement so the contractor can edit and resend. |
| POST | `/api/v1/deals/{deal_id}/proposal/generate` | get_current_user_optional + optional ?token= | Run the AI proposal generator over the deal's scope, render PDF + DOCX, persist, and return the finished propo |
| POST | `/api/v1/deals/{deal_id}/proposal/resend-to-client` | get_current_user_optional + optional ?token= | Create a fresh Adobe Sign agreement after a cancel/decline/expiry, superseding the old one. |
| POST | `/api/v1/deals/{deal_id}/proposal/save` | get_current_user (401 if no cookie) — the ONLY proposal endp | Copy a deal-generated proposal into the `proposals` table so it shows up on the contractor's Proposals page. |
| POST | `/api/v1/deals/{deal_id}/proposal/send-to-crm` | get_current_user_optional + optional ?token= | Push the proposal into the contractor's GHL sub-account as a Documents & Contracts document and send it to the |
| POST | `/api/v1/deals/{deal_id}/proposal/submit` | get_current_user_optional + optional ?token= | DEPRECATED. Legacy single-signer flow: auto-match a contractor and send the proposal PDF to the client via Ado |
| POST | `/api/v1/deals/{deal_id}/proposal/submit-to-client` | get_current_user_optional + optional ?token= | Current flow: send the proposal via Adobe Sign with dual signing (contractor first, then client). |
| GET | `/api/v1/deals/{deal_id}/proposal/{proposal_id}` | get_current_user_optional + optional ?token= | Poll a specific proposal's generation status. |
| GET | `/api/v1/deals/{deal_id}/scope` | get_current_user_optional + optional ?token= | Fetch the latest scope draft as JSON, or download it as a PDF or DOCX. |
| POST | `/api/v1/deals/{deal_id}/scope` | get_current_user_optional + optional ?token= | Generate (or return the already-saved) Scope of Work draft from the collected answers via the V3 SOW pipeline. |
| PUT | `/api/v1/deals/{deal_id}/scope` | get_current_user_optional + optional ?token= | Edit the latest scope draft in place (partial update). |
| POST | `/api/v1/deals/{deal_id}/select-contractor` | get_current_user_optional + optional ?token= | Assign a contractor to the deal and email them a project-notification with a view link. |

## contractors-clients

| Method | Path | Auth | Summary |
|---|---|---|---|
| GET | `/api/v1/clients/` | get_current_user (any authenticated role reaches the handler | Fetch a single client profile by id supplied as a query parameter. |
| POST | `/api/v1/clients/` | NONE. No Depends. Anonymous, like POST /contractors/, but no | GHL webhook that creates a client, its auth_profile, and its first project from a Client Project Quote submiss |
| PUT | `/api/v1/clients/{client_id}` | get_current_user + hand-rolled check current_user.role != Pe | Client updates their own profile; changed fields are pushed to GHL in a background task. |
| GET | `/api/v1/contractor/health` | NONE | Liveness probe for the contractor router. |
| GET | `/api/v1/contractor/proposals/{proposal_id}` | require_role(UserRole.CONTRACTOR) | Fetch one of the authenticated contractor's own proposals, enriched with contractor identity and project stub. |
| GET | `/api/v1/contractors/` | require_permission(Permission.CONTRACTOR_READ) | List contractors with optional trade filter, pagination, and plan-tier gating for clients. |
| POST | `/api/v1/contractors/` | NONE. No Depends, no API key, no signature check, no IP allo | GHL webhook that creates a contractor row from a Contractor Bid Application form submission. |
| PUT | `/api/v1/contractors/{contractor_id}` | get_current_user + hand-rolled check current_user.role != Pe | Contractor updates their own profile; changed fields are pushed to GHL in a background task. |
| POST | `/api/v1/contractors/{contractor_id}/logo` | get_current_user + hand-rolled role check (403 if not CONTRA | Upload a contractor company logo to Supabase storage and save the public URL on the profile. |
| GET | `/api/v1/contractors/{contractor_id}/profile` | NONE. No Depends at all, not even get_current_user_optional. | Public contractor preview page data: the contractor row plus their latest AI classification result. |

## proposals-docs

| Method | Path | Auth | Summary |
|---|---|---|---|
| GET | `/api/v1/documents/` | get_current_user | Batch-fetch document metadata plus public URLs for a comma-separated list of document ids. |
| DELETE | `/api/v1/documents/{document_id}` | get_current_user | Soft-delete a document, remove the underlying file, and refund the storage quota. |
| GET | `/api/v1/opportunities/` | get_current_user PLUS valid GHL token and location_id | Proxy to GHL: search/paginate opportunities in the caller's sub-account. |
| GET | `/api/v1/opportunities/pipelines` | get_current_user (any role) PLUS a valid GHL OAuth token and | Proxy to GHL: list all opportunity pipelines for the caller's GHL sub-account. |
| GET | `/api/v1/opportunities/{opportunity_id}` | get_current_user PLUS valid GHL token and location_id | Proxy to GHL: fetch a single opportunity by id. |
| GET | `/api/v1/proposals/` | get_current_user | List proposals with role-based isolation and pagination. |
| POST | `/api/v1/proposals/` | require_contractor | Create a proposal manually (non-AI path). |
| POST | `/api/v1/proposals/generate` | require_contractor | Kick off asynchronous AI proposal generation for a project; returns immediately with a proposal id to poll. |
| GET | `/api/v1/proposals/health` | NONE | Intended liveness check for the proposals module; unreachable in practice. |
| DELETE | `/api/v1/proposals/{proposal_id}` | require_contractor | Hard-delete a proposal and wipe its storage folder. |
| GET | `/api/v1/proposals/{proposal_id}` | get_current_user_optional (NO auth required, this endpoint i | Fetch one proposal; works both authenticated (full record) and unauthenticated (minimal status payload for pol |
| PUT | `/api/v1/proposals/{proposal_id}` | get_current_user, with a manual role check inside the body | Partially update a proposal the calling contractor owns. |
| POST | `/api/v1/proposals/{proposal_id}/accept` | get_current_user, with a manual role check inside the body | Client accepts a submitted proposal; also marks the project awarded. |
| GET | `/api/v1/proposals/{proposal_id}/attachments` | get_current_user | List non-deleted attachments for a proposal. |
| POST | `/api/v1/proposals/{proposal_id}/attachments` | require_contractor (= require_role(UserRole.CONTRACTOR)) | Upload a file attachment onto a contractor-owned proposal. |
| DELETE | `/api/v1/proposals/{proposal_id}/attachments/{document_id}` | get_current_user | Soft-delete one attachment and remove its file from storage. |
| POST | `/api/v1/proposals/{proposal_id}/decline` | get_current_user, with a manual role check inside the body | Client declines a submitted proposal with a reason code and optional feedback. |
| POST | `/api/v1/proposals/{proposal_id}/generate-pdf` | require_contractor | Regenerate the PDF for an existing proposal and store the new public URL. |
| POST | `/api/v1/proposals/{proposal_id}/submit` | require_contractor | Flip a proposal's status to 'submitted'. |
| GET | `/api/v1/user/documents/` | get_current_user (any authenticated role) | List every non-deleted document the caller uploaded, newest first. |
| POST | `/api/v1/user/documents/` | get_current_user (any authenticated role, no role restrictio | Upload a file into the caller's personal knowledge base for chat AI context. |

## misc

| Method | Path | Auth | Summary |
|---|---|---|---|
| POST | `/api/v1/chat/kairo — NOT MOUNTED, RETURNS 404` | get_current_user (would be) | NOT MOUNTED. Full KAIro orchestration: intent detection, conditional RGA, planning, agent execution. |
| POST | `/api/v1/chat/rga — NOT MOUNTED, RETURNS 404` | get_current_user (would be; router is not included) | NOT MOUNTED. Multi-turn Requirements Gathering Agent chat with DB-persisted sessions. |
| GET | `/api/v1/chat/rga/health — NOT MOUNTED, RETURNS 404` | NONE (no get_current_user), only the session_manager depende | NOT MOUNTED. RGA service health plus a DB connectivity probe. |
| GET | `/api/v1/chat/rga/sessions — NOT MOUNTED, RETURNS 404` | get_current_user (would be) | NOT MOUNTED. List the caller's RGA sessions. |
| DELETE | `/api/v1/chat/rga/sessions/{session_id} — NOT MOUNTED, RETURNS 404` | get_current_user (would be) | NOT MOUNTED. Mark an RGA session abandoned (data retained). |
| GET | `/api/v1/chat/rga/sessions/{session_id} — NOT MOUNTED, RETURNS 404` | get_current_user (would be) | NOT MOUNTED. Fetch metadata for one RGA session. |
| GET | `/api/v1/client-training-data/export` | NONE. No dependency at all. | Bulk export client classification training examples. |
| GET | `/api/v1/client-training-data/review-queue` | NONE. No dependency at all. | List CLIENT classifications whose confidence falls in a review band, for human triage. |
| GET | `/api/v1/client-training-data/stats` | NONE. No dependency at all. | Aggregate counts of the client training dataset, by source, split, segment and priority. |
| POST | `/api/v1/client-training-data/submit-correction` | NONE. No dependency at all. | Write a human ground-truth correction for a client classification into the training set. |
| GET | `/api/v1/conversations/` | get_current_user (401 without bs_session cookie). No permiss | List the authenticated user's conversation threads, newest-updated first. |
| POST | `/api/v1/conversations/` | get_current_user | Create a new conversation thread for the caller, subject to a plan conversation cap. |
| DELETE | `/api/v1/conversations/{conversation_id}` | get_current_user | Soft-delete a conversation (sets status='deleted' and deleted_at=now). |
| GET | `/api/v1/conversations/{conversation_id}` | get_current_user | Fetch one conversation by id, scoped to the caller. |
| PATCH | `/api/v1/conversations/{conversation_id}` | get_current_user | Partially update a conversation's title, status, context_summary, or metadata. |
| POST | `/api/v1/conversations/{conversation_id}/archive` | get_current_user | Set a conversation's status to 'archived'. |
| GET | `/api/v1/conversations/{conversation_id}/messages` | get_current_user, plus verify_conversation_ownership helper | Paginated message history for one conversation, oldest first. |
| POST | `/api/v1/conversations/{conversation_id}/messages` | get_current_user, plus verify_conversation_ownership | Persist a user message in a conversation without invoking the AI. |
| POST | `/api/v1/conversations/{conversation_id}/messages/stream` | get_current_user, plus verify_conversation_ownership | Create (or replay) a user message and stream the Kairo orchestrator's reply back over SSE. |
| DELETE | `/api/v1/conversations/{conversation_id}/messages/{message_id}` | get_current_user, plus verify_conversation_ownership | Soft-delete a message (sets deleted_at). |
| GET | `/api/v1/conversations/{conversation_id}/messages/{message_id}` | get_current_user, plus verify_conversation_ownership | Fetch a single message inside a conversation. |
| PATCH | `/api/v1/conversations/{conversation_id}/messages/{message_id}` | get_current_user, plus verify_conversation_ownership | Edit a message's content and/or metadata in place. |
| POST | `/api/v1/conversations/{conversation_id}/messages/{message_id}/attachments` | get_current_user, plus verify_conversation_ownership | Upload a file attachment to an existing message and register it in the documents table. |
| POST | `/api/v1/conversations/{conversation_id}/unarchive` | get_current_user | Return an archived conversation to status='active'. |
| POST | `/api/v1/feedback/` | get_current_user (401 without cookie). No permission or role | Accept in-app feedback text and email it to the AFC team. |
| GET | `/api/v1/health/` | NONE | Liveness probe for monitoring and deploy platforms. |
| GET | `/api/v1/training-data/export` | NONE. No dependency at all. | Bulk export contractor classification training examples. |
| GET | `/api/v1/training-data/review-queue` | NONE. No dependency at all. | List CONTRACTOR classifications whose confidence falls in a review band, for human triage. |
| GET | `/api/v1/training-data/stats` | NONE. No dependency at all. | Aggregate counts of the contractor training dataset. |
| POST | `/api/v1/training-data/submit-correction` | NONE. No dependency at all. | Write a human ground-truth correction for a contractor classification into the training set. |
| POST | `/api/v1/triggers/webhook/client-application` | SHARED SECRET, not the session cookie. Requires header X-GHL | Ingest a GHL client application, dedupe it, run the client classifier and downstream matching. |
| POST | `/api/v1/triggers/webhook/contractor-application` | NONE. No dependency, no secret header, completely open. | Ingest a raw contractor application payload, normalize it, persist it, and run the LLM contractor classifier. |
| POST | `/api/v1/triggers/webhook/project-match` | NONE. Completely open, no cookie, no secret. | Kick off contractor matching for a UI-created project as a background task. |
| GET | `/api/v1/webhooks/adobe-sign` | NONE. Header X-AdobeSign-ClientId is inspected but a MISSING | Adobe Sign webhook URL verification handshake, echoes the client id back. |
| POST | `/api/v1/webhooks/adobe-sign` | NONE in the FastAPI sense. Weak app-level check: X-AdobeSign | Process Adobe Sign e-signature lifecycle events against proposals or deals. |
| POST | `/api/v1/webhooks/highlevel` | NONE. | GHL webhook receiver stub, prints the body and does nothing else. |

---

*Generated from source on 2026-08-07 against `feat/role-selection-auth-error`. If an endpoint here disagrees with `https://api.buildsuite.ai/docs`, the live OpenAPI spec wins.*
