'use client';

import { useRef, useState } from 'react';

import { fitWithin, MAX_PHOTO_BYTES, PHOTO_MAX_EDGE } from '@/lib/field-task';

/**
 * A homeowner sending their contractor a photo or a document.
 *
 * The same shape as the crew's uploader and for the same reason: a phone photo
 * is 2–10 MB and an upload is capped well below that, so images are shrunk here
 * before they leave the phone. Anything that is not an image — a PDF of a
 * permit, a quote from elsewhere — is sent as it is, and refused politely if it
 * is too big, because a document cannot be re-encoded without changing it.
 *
 * Each file is sent on its own and saved at once, so nothing is lost if the
 * page is closed halfway.
 */

type UploadResult = { ok: true } | { ok: false; error: string };

interface Item {
  key: string;
  name: string;
  state: 'preparing' | 'uploading' | 'saved' | 'failed';
  error?: string;
}

async function prepare(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    if (file.size > MAX_PHOTO_BYTES) {
      throw new Error('That file is too large to send here. Email it to your contractor instead.');
    }
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    if (file.size <= MAX_PHOTO_BYTES) return file;
    throw new Error('That photo could not be read here. Try taking it with the camera instead.');
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, PHOTO_MAX_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) {
    bitmap.close();
    throw new Error('This device could not prepare the photo.');
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (blob === null) throw new Error('This device could not prepare the photo.');
  return blob;
}

export function ClientFileUploader({
  upload,
  projectId,
}: {
  upload: (formData: FormData) => Promise<UploadResult>;
  projectId: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const queue = useRef(Promise.resolve());

  const patch = (key: string, next: Partial<Item>) =>
    setItems((all) => all.map((i) => (i.key === key ? { ...i, ...next } : i)));

  function add(files: FileList | null) {
    if (files === null) return;
    for (const file of Array.from(files)) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setItems((all) => [...all, { key, name: file.name, state: 'preparing' }]);

      queue.current = queue.current.then(async () => {
        try {
          const blob = await prepare(file);
          patch(key, { state: 'uploading' });
          const form = new FormData();
          const isImage = blob.type.startsWith('image/');
          const name = isImage ? file.name.replace(/\.[^.]+$/, '') + '.jpg' : file.name;
          form.append('file', new File([blob], name || 'upload', { type: blob.type || file.type }));
          form.append('projectId', projectId);
          const result = await upload(form);
          patch(key, result.ok ? { state: 'saved' } : { state: 'failed', error: result.error });
        } catch (error) {
          patch(key, {
            state: 'failed',
            error: error instanceof Error ? error.message : 'That file did not send. Try again.',
          });
        }
      });
    }
  }

  const saved = items.filter((i) => i.state === 'saved').length;

  return (
    <div className="space-y-2.5">
      <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg bg-navy-900 px-3.5 text-sm font-semibold text-white transition hover:bg-navy-800">
        Upload a file
        <input
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="sr-only"
          onChange={(e) => {
            add(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
      </label>

      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.key} className="text-xs text-navy-600">
              <span className="font-medium text-navy-800">{item.name}</span>{' '}
              {item.state === 'saved'
                ? '· sent to your contractor'
                : item.state === 'failed'
                  ? `· not sent — ${item.error}`
                  : item.state === 'uploading'
                    ? '· sending…'
                    : '· preparing…'}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-navy-400" aria-live="polite">
        {saved > 0
          ? `${saved} file${saved === 1 ? '' : 's'} sent. Your contractor can see them.`
          : 'Photos and PDFs. Your contractor sees what you send here.'}
      </p>
    </div>
  );
}
