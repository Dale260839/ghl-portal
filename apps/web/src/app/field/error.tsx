'use client';

import { FriendlyError } from '@/components/friendly-error';

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
      backHref="/field"
      backLabel="Back to Today"
      what="This screen"
    />
  );
}
