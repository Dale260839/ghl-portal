'use client';

import { useEffect, useRef, useState } from 'react';

import { fitWithin, MAX_PHOTO_BYTES, PHOTO_MAX_EDGE } from '@/lib/field-task';

/**
 * Add photos from a phone: take one, or choose several.
 *
 * Each photo is shrunk here, then saved at once — one request per photo — and
 * shows "Saved" once it is on the job file. Nothing waits for a later "submit",
 * so a photo taken on site is kept even if the rest of the form is never sent.
 * See `lib/field-task.ts` for why the shrinking is not optional.
 */

type UploadResult = { ok: true; photoId?: string } | { ok: false; error: string };

interface Item {
  key: string;
  name: string;
  preview: string;
  state: 'shrinking' | 'uploading' | 'saved' | 'failed';
  error?: string;
  /**
   * The row this photo became, when the server told us.
   *
   * Carried into the enclosing form as a hidden input so the submission can
   * file these photographs against the update they were sent with. A photo
   * that failed contributes nothing, which is the point: the form links what
   * actually saved, not what was chosen.
   */
  photoId?: string;
}

async function shrink(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // A format this browser cannot draw (HEIC on a desktop, say). Send it as it
    // is if it is small enough; otherwise say what to do instead.
    if (file.size <= MAX_PHOTO_BYTES) return file;
    throw new Error('This photo’s format can’t be read here. Take it with the camera button instead.');
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, PHOTO_MAX_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) {
    bitmap.close();
    throw new Error('This phone could not prepare the photo.');
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (blob === null) throw new Error('This phone could not prepare the photo.');
  return blob;
}

export function PhotoUploader({
  upload,
  fields = {},
  formFields = [],
  countFieldName,
}: {
  /** A server action taking one photo as `file`, plus `fields`. */
  upload: (formData: FormData) => Promise<UploadResult>;
  /** Sent with every photo, e.g. `{ taskId }`. */
  fields?: Record<string, string>;
  /** Read at upload time from the enclosing form, e.g. the project `<select>`. */
  formFields?: string[];
  /** A hidden input carrying how many photos were saved, for the form around it. */
  countFieldName?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const queue = useRef(Promise.resolve());

  useEffect(() => () => items.forEach((i) => URL.revokeObjectURL(i.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (key: string, next: Partial<Item>) =>
    setItems((all) => all.map((i) => (i.key === key ? { ...i, ...next } : i)));

  function add(files: FileList | null) {
    if (files === null) return;
    for (const file of Array.from(files)) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const item: Item = { key, name: file.name, preview: URL.createObjectURL(file), state: 'shrinking' };
      setItems((all) => [...all, item]);

      // One at a time: a site connection handles a queue better than a burst.
      queue.current = queue.current.then(async () => {
        try {
          const blob = await shrink(file);
          patch(key, { state: 'uploading' });
          const form = new FormData();
          const name = file.name.replace(/\.[^.]+$/, '') + (blob.type === 'image/jpeg' ? '.jpg' : '');
          form.append('file', new File([blob], name || 'photo.jpg', { type: blob.type || file.type }));
          for (const [k, v] of Object.entries(fields)) form.append(k, v);
          const enclosing = root.current?.closest('form');
          for (const fieldName of formFields) {
            const field = enclosing?.elements.namedItem(fieldName);
            if (field instanceof HTMLSelectElement || field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
              form.append(fieldName, field.value);
            }
          }
          const result = await upload(form);
          patch(
            key,
            result.ok
              ? { state: 'saved', ...(result.photoId !== undefined ? { photoId: result.photoId } : {}) }
              : { state: 'failed', error: result.error },
          );
        } catch (error) {
          patch(key, {
            state: 'failed',
            error: error instanceof Error ? error.message : 'The photo did not upload. Try again.',
          });
        }
      });
    }
  }

  const saved = items.filter((i) => i.state === 'saved').length;
  const busy = items.some((i) => i.state === 'shrinking' || i.state === 'uploading');
  const button =
    'inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-navy-200 bg-white px-3.5 text-sm font-medium text-navy-800 transition hover:bg-navy-50';

  return (
    <div ref={root} className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        <label className={button}>
          Take photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              add(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          />
        </label>
        <label className={button}>
          Choose photos
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              add(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          />
        </label>
      </div>

      {countFieldName !== undefined && <input type="hidden" name={countFieldName} value={saved} />}

      {/* One per saved photo. The server reads them all with getAll(). */}
      {items
        .filter((i) => i.state === 'saved' && i.photoId !== undefined)
        .map((i) => (
          <input key={i.photoId} type="hidden" name="photoId" value={i.photoId} />
        ))}

      {items.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((item) => (
            <li key={item.key} className="relative overflow-hidden rounded-lg border border-navy-100 bg-navy-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.preview} alt={item.name} className="aspect-square w-full object-cover" />
              <span
                className={`absolute inset-x-0 bottom-0 px-1.5 py-1 text-[11px] font-medium ${
                  item.state === 'saved'
                    ? 'bg-emerald-600/90 text-white'
                    : item.state === 'failed'
                      ? 'bg-red-600/90 text-white'
                      : 'bg-navy-900/70 text-white'
                }`}
              >
                {item.state === 'saved'
                  ? 'Saved'
                  : item.state === 'failed'
                    ? 'Not saved'
                    : item.state === 'uploading'
                      ? 'Uploading…'
                      : 'Preparing…'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {items.filter((i) => i.state === 'failed').map((i) => (
        <p key={i.key} role="alert" className="text-xs text-red-700">
          {i.error}
        </p>
      ))}

      <p className="text-xs text-navy-400" aria-live="polite">
        {busy
          ? 'Saving photos — keep this screen open.'
          : saved > 0
            ? `${saved} photo${saved === 1 ? '' : 's'} saved to the job.`
            : 'Photos are saved to the job as soon as you add them. Internal until your PM shares them.'}
      </p>
    </div>
  );
}
