'use client';

import { FriendlyError } from '@/components/friendly-error';

/** Who this screen belongs to. */
const ALLOWED = ['contractor'] as const;

export default function ProjectWorkspaceError({
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
      backHref="/dashboard/projects"
      backLabel="Back to projects"
      what="This part of the project"
    />
  );
}
