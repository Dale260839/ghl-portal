# Invoice creation safety and recovery

Apply Hub migration 0014 before deploying this change. It adds two nullable
columns and does not modify existing invoices or access policies. If it is
missing, creation fails closed before contacting GHL.

Each create action atomically claims an uncreated draft. The returned row is
the snapshot sent to GHL; edits are blocked once claimed. Only the winning
attempt can save the external ID. Claims never expire automatically.

An interrupted request, rejected API call, or failed reference save remains
locked. This intentionally prefers a review over a duplicate invoice. The
ordinary UI cannot release the lock.

## Owner reconciliation

1. Stop all attempts for the affected draft. Wait for any in-flight request to
   finish. Identify the contractor, project, stage, amount and attempt timestamp.
2. Check the correct GHL location for that invoice, including recent drafts.
   If a create succeeded but reference saving failed, the Hub error includes
   the external ID. Do not create another invoice.
3. If exactly one matching invoice exists, an authorized database operator
   should record its ID and v2 payments URL on this draft, preserving the claim.
   Match both draft ID and contractor ID. Do not mark it sent.
4. Only when GHL definitively confirms no invoice was created, and there is no
   in-flight request, may the operator clear creation_attempt_id and
   creation_started_at on that single uncreated draft. Never bulk-clear claims.
5. If the outcome is still uncertain, leave the claim in place and investigate.

Deployment is not a live concurrency test. Exercise concurrency and network
failures using the injected fake transport in creation-concurrency.test.ts.
