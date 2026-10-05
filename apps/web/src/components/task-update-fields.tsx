'use client';

import { useEffect, useRef, useState } from 'react';
import { TASK_STATUSES } from '@buildsuite/contracts';
import { PhotoUploader } from '@/components/photo-uploader';
import { FieldUploadProvider } from '@/components/field-upload-context';
import { FieldSubmit } from '@/components/field-submit';

export function TaskUpdateFields({ taskId, status, upload }: {
  taskId: string;
  status: string;
  upload: (data: FormData) => Promise<{ ok: true; photoId?: string } | { ok: false; error: string }>;
}) {
  // Controlled fields survive React's native form reset after a rejected action.
  // NoticeForm remounts these fields only once the update has actually saved.
  const [text, setText] = useState('');
  const [nextStatus, setNextStatus] = useState('');
  const workField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const form = workField.current?.form;
    if (!form) return;
    // NoticeForm owns the reset after a save; React also resets rejected actions.
    const retain = (event: Event) => event.preventDefault();
    form.addEventListener('reset', retain);
    return () => form.removeEventListener('reset', retain);
  }, []);
  const input = 'w-full rounded-lg border border-navy-200 bg-white px-3 py-2.5 text-sm';

  return <FieldUploadProvider>
    <input type="hidden" name="taskId" value={taskId} />
    <label className="block text-xs font-medium text-navy-600">
      What did you do?
      <textarea ref={workField} name="text" rows={3} value={text} onChange={(event) => setText(event.target.value)} className={`${input} mt-1.5`} placeholder="e.g. Ran the kitchen circuits, boxes set, ready for inspection" />
    </label>
    <div>
      <div className="text-xs font-medium text-navy-600">Photos</div>
      <div className="mt-1.5">
        <PhotoUploader upload={upload} fields={{ taskId }} countFieldName="photoCount" />
      </div>
    </div>
    <label className="block text-xs font-medium text-navy-600">
      Status
      <select name="status" value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className={`${input} mt-1.5`}>
        <option value="">Leave as {status}</option>
        {TASK_STATUSES.filter((candidate) => candidate !== status).map((candidate) => (
          <option key={candidate} value={candidate}>Set to {candidate}</option>
        ))}
      </select>
    </label>
    <FieldSubmit>Send update to PM</FieldSubmit>
  </FieldUploadProvider>;
}
