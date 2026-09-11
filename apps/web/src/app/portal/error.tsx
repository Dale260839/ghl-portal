'use client';

import { FriendlyError } from '@/components/friendly-error';

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
      backHref="/portal"
      backLabel="Back to your project"
      what="This page"
    />
  );
}
