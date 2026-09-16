'use client';

import { FriendlyError } from '@/components/friendly-error';

/** Who this screen belongs to. A contractor may preview the field and portal screens too. */
const ALLOWED = ['field', 'contractor'] as const;

export default function FieldError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <FriendlyError
      error={error}
      reset={reset}
      allowedRoles={ALLOWED}
      backHref="/field"
      backLabel="Back to Today"
      what="This screen"
    />
  );
}
