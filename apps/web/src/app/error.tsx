'use client';

import { FriendlyError } from '@/components/friendly-error';

const ALLOWED = ['contractor', 'field', 'client'] as const;

// A segment's own error boundary cannot catch failures in that segment's layout.
export default function WorkspaceError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <FriendlyError error={error} reset={reset} allowedRoles={ALLOWED}
    backHref="/" backLabel="Go to sign-in" what="This workspace" />;
}
