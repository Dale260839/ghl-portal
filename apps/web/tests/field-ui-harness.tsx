import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import { PhotoUploader } from '../src/components/photo-uploader';
import { FieldUploadProvider } from '../src/components/field-upload-context';
import { FieldSubmit } from '../src/components/field-submit';
import { ClearFieldDraft, FieldDraft } from '../src/components/field-draft';
import { NoticeForm } from '../src/components/notice-form';
import { TaskUpdateFields } from '../src/components/task-update-fields';

function Harness() {
  const [user, setUser] = useState('one');
  const [failAll, setFailAll] = useState(false);
  const failures = useRef(false);
  failures.current = failAll;
  const requests = useRef<string[]>([]);
  const [posted, setPosted] = useState('');
  const [taskMode, setTaskMode] = useState(false);
  const [rejectTask, setRejectTask] = useState(true);
  const [dailyLanding, setDailyLanding] = useState(false);
  const [landingRevision, setLandingRevision] = useState<string | null>(null);
  const lastSubmission = useRef<string | null>(null);
  async function upload(form: FormData) {
    requests.current.push(String(form.get('projectId') ?? form.get('taskId')));
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (failures.current || requests.current.length === 1) return { ok: false as const, error: 'Test connection failed' };
    return { ok: true as const, photoId: `test-photo-${requests.current.length}` };
  }
  if (dailyLanding) return <main>
    <ClearFieldDraft draftKey={'bs_field_draft:v2:' + user} submittedRevision={landingRevision} />
    <button onClick={() => setDailyLanding(false)}>New daily update</button>
  </main>;
  if (taskMode) return <main>
    <label><input type="checkbox" checked={rejectTask} onChange={(event) => setRejectTask(event.target.checked)} />Reject task submission</label>
    <NoticeForm action={async (_previous, data) => {
      setPosted(JSON.stringify({ ...Object.fromEntries(data), photoIds: data.getAll('photoId') }));
      if (rejectTask) return { reset: false, notice: 'Nothing submitted; try again later' };
      return { notice: 'Task update saved' };
    }}>
      <TaskUpdateFields taskId="task1" status="Not Started" upload={upload} />
    </NoticeForm>
    <output>{posted}</output>
  </main>;
  return <main>
    <button onClick={() => { requests.current = []; setPosted(''); setTaskMode(true); }}>Task mode</button>
    <button onClick={() => setUser(user === 'one' ? 'two' : 'one')}>Change user</button>
    <button onClick={() => {
      const form = document.querySelector('form')!;
      lastSubmission.current = new FormData(form).get('draftRevision') as string | null;
      setLandingRevision(lastSubmission.current);
      setDailyLanding(true);
    }}>Successful update landing</button>
    <button onClick={() => { setLandingRevision(lastSubmission.current); setDailyLanding(true); }}>Revisit previous success</button>
    <label><input type="checkbox" checked={failAll} onChange={(e) => setFailAll(e.target.checked)} />Fail all uploads</label>
    <form key={user} onSubmit={(e) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      setPosted(JSON.stringify({ ...Object.fromEntries(data), photoIds: data.getAll('photoId') }));
    }}>
      <FieldUploadProvider>
        <FieldDraft draftKey={'bs_field_draft:v2:' + user} />
        <label>Project<select name="projectId" defaultValue="p1"><option value="p1">Job One</option><option value="p2">Job Two</option></select></label>
        <label>Work<textarea name="workCompleted" /></label>
        <label>Internal notes<textarea name="internalNotes" /></label>
        <label>Crew<input name="crewOnsite" type="number" defaultValue={2} /></label>
        <label>Hours<input name="hoursWorked" type="number" step={0.5} defaultValue={8} /></label>
        <label>Weather<input name="weather" defaultValue="Clear" /></label>
        <label><input name="clientDecisionNeeded" type="checkbox" />Client decision needed</label>
        <PhotoUploader upload={upload} formFields={['projectId']} />
        <FieldSubmit>Send update</FieldSubmit>
      </FieldUploadProvider>
    </form>
    <output>{posted}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
