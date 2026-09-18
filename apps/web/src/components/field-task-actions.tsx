import { setFieldTaskStatus } from '@/lib/actions/field-tasks';
import { NoticeForm } from '@/components/notice-form';
import { SubmitButton } from '@/components/submit-button';

export function FieldTaskActions({ taskId }: { taskId: string }) {
  return (
    <NoticeForm action={setFieldTaskStatus} className="mt-2.5 flex flex-wrap gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      <SubmitButton name="status" value="In Progress" className="flex-1 rounded-lg bg-navy-900 px-3 py-2.5 text-sm font-semibold text-white">
        Start
      </SubmitButton>
      <SubmitButton name="status" value="Ready for Review" className="flex-1 rounded-lg border border-navy-200 px-3 py-2.5 text-sm font-medium text-navy-700">
        Ready for review
      </SubmitButton>
    </NoticeForm>
  );
}
