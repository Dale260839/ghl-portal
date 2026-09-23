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
 * A sign-in can also belong to an agency administrator with no contractor
 * record, so the explanation must not imply every case is an onboarding error.
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
        We can&apos;t show {what.toLowerCase()} until this sign-in is linked to a contractor. Rather
        than show you another company&apos;s records, we show none.
      </p>
      <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-navy-400">
        Ask your BuildSuite administrator to link this sign-in to the correct contractor record.
        A GoHighLevel sign-in alone does not choose a contractor for billing.
      </p>
      {email !== undefined && email !== '' ? (
        <p className="mx-auto mt-2 max-w-lg text-xs text-navy-400">
          Sign-in: <span className="font-medium text-navy-600">{email}</span>
        </p>
      ) : null}
    </Card>
  );
}
