'use client';

import { FriendlyError } from '@/components/friendly-error';

export default function DashboardError({
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
      backHref="/dashboard"
      backLabel="Back to dashboard"
      what="This screen"
    />
  );
}
