'use client';

import { useActionState, type ReactNode } from 'react';

/** What an action can hand back to the form that called it. */
export interface ActionNotice {
  notice?: string;
}

/**
 * A form whose action answers with a sentence, shown in the form.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT A REDIRECT WITH `?notice=` (2026-09-17)
 *
 * The Schedule actions first redirected back to the same page with the notice
 * in the query. The server answered correctly — a 303 carrying the rendered
 * page, notice included — but the browser never applied it: the submit button
 * stayed on "Add appointment…" and the page sat pending. The appointment was
 * saved and the emails were sent; the contractor was shown neither.
 *
 * Returning the notice as action state involves no navigation at all, so there
 * is nothing to hang. The page still refreshes through `revalidatePath`.
 * ---------------------------------------------------------------------------
 */
export function NoticeForm({
  action,
  className,
  noticeClassName,
  children,
}: {
  action: (previous: ActionNotice | undefined, formData: FormData) => Promise<ActionNotice | undefined>;
  className?: string;
  noticeClassName?: string;
  children: ReactNode;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.notice !== undefined && state.notice !== '' && (
        <p
          role="status"
          className={
            noticeClassName ??
            'rounded-lg border border-navy-100 bg-navy-50 px-3 py-2 text-xs leading-relaxed text-navy-700'
          }
        >
          {state.notice}
        </p>
      )}
    </form>
  );
}
