import { setFieldTaskStatus } from '@/lib/actions/field-tasks';
import { NoticeForm } from '@/components/notice-form';
import { SubmitButton } from '@/components/submit-button';

/**
 * The two things a crew member does to a task, on a phone, in gloves.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG WITH IT
 *
 * The form itself was the flex row, and `NoticeForm` renders its message as a
 * sibling of the children — so after a submit the notice became a THIRD column
 * beside the two buttons. All three were squeezed, "Ready for review" wrapped
 * onto three lines inside a button, and the row grew to twice the height of
 * the ones around it. The buttons are in their own row now and the notice sits
 * underneath where a sentence belongs.
 *
 * The second problem was worse than cosmetic: both buttons were always
 * offered, so a task already In Progress still showed "Start", and tapping it
 * produced "Already In Progress." A control that exists only to tell you it
 * did nothing should not be a control. The action matching the task's current
 * status is disabled, and says why.
 * ---------------------------------------------------------------------------
 */
export function FieldTaskActions({ taskId, status }: { taskId: string; status?: string }) {
  const started = status === 'In Progress';
  const submitted = status === 'Ready for Review' || status === 'Completed';

  return (
    <NoticeForm action={setFieldTaskStatus} className="mt-3 space-y-2">
      <input type="hidden" name="taskId" value={taskId} />

      <div className="flex gap-2">
        <SubmitButton
          name="status"
          value="In Progress"
          disabled={started || submitted}
          // `min-h-12` is 48px — the field guidance, not the 44px floor, because
          // this is the one control that gets used standing on a ladder.
          // `whitespace-nowrap` because a button whose label wraps stops looking
          // like a button.
          className="min-h-12 flex-1 basis-0 rounded-lg bg-navy-900 px-3 text-sm font-semibold whitespace-nowrap text-white transition-colors disabled:cursor-not-allowed disabled:bg-navy-100 disabled:text-navy-400"
        >
          {started ? 'Started' : 'Start'}
        </SubmitButton>

        <SubmitButton
          name="status"
          value="Ready for Review"
          disabled={submitted}
          className="min-h-12 flex-1 basis-0 rounded-lg border border-navy-200 px-3 text-sm font-medium whitespace-nowrap text-navy-700 transition-colors disabled:cursor-not-allowed disabled:border-navy-100 disabled:text-navy-400"
        >
          {submitted ? 'Submitted' : 'Ready for review'}
        </SubmitButton>
      </div>
    </NoticeForm>
  );
}
