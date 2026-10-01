import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import { PhotoUploader } from '../src/components/photo-uploader';
import { FieldUploadProvider } from '../src/components/field-upload-context';
import { FieldSubmit } from '../src/components/field-submit';
import { FieldDraft } from '../src/components/field-draft';

function Harness() {
  const [user, setUser] = useState('one');
  const [failAll, setFailAll] = useState(false);
  const failures = useRef(false);
  failures.current = failAll;
  const requests = useRef<string[]>([]);
  const [posted, setPosted] = useState('');
  async function upload(form: FormData) {
    requests.current.push(String(form.get('projectId')));
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (failures.current || requests.current.length === 1) return { ok: false as const, error: 'Test connection failed' };
    return { ok: true as const, photoId: 'test-photo' };
  }
  return <main>
    <button onClick={() => setUser(user === 'one' ? 'two' : 'one')}>Change user</button>
    <label><input type="checkbox" checked={failAll} onChange={(e) => setFailAll(e.target.checked)} />Fail all uploads</label>
    <form key={user} onSubmit={(e) => {
      e.preventDefault();
      setPosted(JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))));
    }}>
      <FieldUploadProvider>
        <FieldDraft draftKey={'bs_field_draft:v2:' + user} />
        <label>Project<select name="projectId" defaultValue="p1"><option value="p1">Job One</option><option value="p2">Job Two</option></select></label>
        <label>Work<textarea name="workCompleted" /></label>
        <label>Internal notes<textarea name="internalNotes" /></label>
        <PhotoUploader upload={upload} formFields={['projectId']} />
        <FieldSubmit>Send update</FieldSubmit>
      </FieldUploadProvider>
    </form>
    <output>{posted}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
