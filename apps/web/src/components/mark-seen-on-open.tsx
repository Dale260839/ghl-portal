'use client';

import { useEffect, useRef } from 'react';

/**
 * Opening an assigned task is seeing it: this clears its "new" badge.
 *
 * The page is a server component and cannot write while rendering, so the
 * write happens once the task is on screen. `markTaskSeen` checks ownership
 * itself and is idempotent.
 *
 * ONCE per task. The action refreshes the page, and the refreshed page hands
 * this component a new action reference; keyed on that, the effect fired again
 * on every refresh — seven writes on one open when the read lagged the write.
 */
export function MarkSeenOnOpen({
  taskId,
  action,
}: {
  taskId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === taskId) return;
    sent.current = taskId;
    const form = new FormData();
    form.append('taskId', taskId);
    void action(form).catch(() => {
      // Not worth interrupting the crew member for: the badge clears on the
      // next status change or update instead.
    });
  }, [taskId, action]);
  return null;
}
