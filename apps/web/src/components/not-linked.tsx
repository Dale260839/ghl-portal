import { Card } from '@/components/ui';

/**
 * What a contractor sees when their sign-in has not been linked to a contractor
 * record in BuildSuite.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN AN ERROR PAGE
 *
 * The Hub's own tables are filed under `contractors.id`, and a session only
 * knows `auth_profiles.id`. `assertContractor` throws when the two cannot be
 * connected, which is right — the alternative was reading under an auth profile
 * id, which quietly hid a contractor's own records for two days.
 *
 * But throwing produced a 500 with a stack trace, and the person seeing it has
 * done nothing wrong and can do nothing about it. This is the same refusal,
 * said in words.
 *
 * Seven of 64 contractor profiles are in this state. It is a one-line fix in
 * BuildSuite, not a fault in their account.
 * ---------------------------------------------------------------------------
 */
export function NotLinkedToContractor({
  what,
  email,
}: {
  /** What they were trying to reach, so the sentence reads naturally. */
  what: string;
  email?: string;
}) {
  return (
    <Card className="px-5 py-10 text-center">
      <p className="text-sm text-navy-600">
        This sign-in isn&apos;t linked to a contractor record yet.
      </p>
      <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-navy-400">
        {what} is filed against a contractor, so we need to know which one you are before showing
        anything. Rather than show you another company&apos;s, we show none.
      </p>
      <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-navy-400">
        This is a one-off fix on the BuildSuite side, not something wrong with your account:
        setting <code>contractor_id</code> on your auth profile
        {email !== undefined && email !== '' ? (
          <>
            {' '}
            for <span className="font-medium text-navy-600">{email}</span>
          </>
        ) : null}
        , or matching your sign-in email to your contractor record.
      </p>
    </Card>
  );
}
