'use client';

import { FriendlyError } from '@/components/friendly-error';

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
      backHref="/dashboard/projects"
      backLabel="Back to projects"
      what="This part of the project"
    />
  );
}
