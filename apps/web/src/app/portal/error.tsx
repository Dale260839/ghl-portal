'use client';

import { FriendlyError } from '@/components/friendly-error';

/** Who this screen belongs to. A contractor may preview the field and portal screens too. */
const ALLOWED = ['client', 'contractor'] as const;

export default function PortalError({
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
      backHref="/portal"
      backLabel="Back to your project"
      what="This page"
    />
  );
}
