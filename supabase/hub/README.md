# The Hub's own database

**There are two databases in this project and they are not interchangeable.**

| | Database | Access | Migrations |
|---|---|---|---|
| **BuildSuite** | `bkngicyqgdwzmoeahqdi` | **Read-only, forever** | none — we never alter it |
| **Project Hub** | `nexpqqxarimqmntnvzff` | Read **and write** | this directory |

`supabase/migrations/0001_hub_tables.sql` was written when the plan was to add
Hub tables *inside* BuildSuite's database. That plan changed on 2026-08-31.
**It is kept for history and must not be run** — it declares foreign keys to
`public.projects`, which does not exist here, so it would fail on the first
table anyway.

Run the files in **this** directory instead.

---

## Running a migration

The Hub connects with a **publishable** key. It is subject to RLS and it cannot
execute DDL — deliberately, because a running application should never be able
to change its own schema. So migrations are run by a person:

1. Supabase dashboard → the **Project Hub** project (`nexpqqxarimqmntnvzff`)
2. **SQL Editor** → **New query**
3. Paste the whole file
4. **Run**

Every file is `create ... if not exists`, so re-running one is safe.

### Verify it worked

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name like 'hub_%'
order by table_name;
```

`0001_initial.sql` should give **16 rows**.

---

## What is in 0001

| Group | Tables |
|---|---|
| **Operational records** | `hub_milestones` · `hub_schedule_items` · `hub_tasks` · `hub_daily_updates` · `hub_update_acknowledgements` · `hub_update_comments` · `hub_issues` · `hub_messages` · `hub_documents` · `hub_photos` · `hub_visibility_settings` |
| **Overlay on BuildSuite** | `hub_project_state` · `hub_activity` |
| **Team** | `hub_memberships` · `hub_invitations` · `hub_grants` |

### The three decisions worth knowing

**No foreign keys to BuildSuite.** `project_id` is a plain indexed uuid. Cross
-database referential integrity is the application's job, and it already does
it: every Hub read is filtered by a project id resolved through a tenant-scoped
BuildSuite read. The constraint was never enforceable across a network boundary,
so its absence is a design decision rather than an oversight.

**RLS is on with no policy.** The publishable key can therefore read and write
nothing until a policy is added, one screen at a time, each reviewed on its own.
Shipping a permissive policy "to tighten later" is how BuildSuite's
`contractors` table ended up fully readable by a key that should never have seen
it. Not repeating that.

**Archive, never delete.** `archived_at` plus who and why. The approval model
depends on being able to say who published what, so destroying a row destroys
the evidence the privacy rules rest on.

---

## The two columns that carry the rules

**`hub_daily_updates` has `internal_notes` and `client_summary` as separate
columns**, and no code path copies one into the other. That separation is what
makes it provable that a crew member's complaint about a supplier cannot reach
the homeowner — it was never in the field that gets published.

**`manager_approval_status`** has three values and the middle one is a trap:
`Approved Internally` is **not** approved for the client. Only
`Approved & Published` reaches a homeowner. Both read as approval in English,
which is precisely why the distinction lives in data.

---

## Permissions: role AND grant, never OR

`hub_memberships.role` is the **ceiling**. `hub_grants` rows can only *narrow*
it.

A field user cannot be ticked into seeing margins, because the role forbids it
and the application's permission matrix is closed by default. If the two were
OR'd, a tick box would become a way to grant something dangerous by accident —
which is exactly how a homeowner ends up seeing a contractor's margin.

## Invitations store a hash, not a token

`hub_invitations.token_hash` only. The raw token exists in the emailed link and
nowhere else, so someone who obtained a dump of this table still could not
accept an invitation. Single-use is enforced by `accepted_at`, checked before
redemption.
