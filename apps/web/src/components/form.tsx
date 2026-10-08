import type { ReactNode } from 'react';

/**
 * One size for every control a person types into.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACES
 *
 * Sixty-four text inputs, selects and textareas across twenty files, written
 * out by hand each time, at four different heights — `py-1`, `py-1.5`, `py-2`
 * and `py-2.5` — with `px-3` or `px-3.5` depending on the file. Nobody chose
 * that; it is what happens when the same control is retyped twenty times.
 *
 * On the crew screens it was also a usability problem rather than a tidiness
 * one: the smallest of those is a 30px target, under the 44px a gloved thumb
 * can reliably hit, on the surface most likely to be used outdoors on a phone.
 *
 * THE SCALE
 *
 * `min-h-11` is 44px. Everything a person types into is at least that, on
 * every screen — there is no "this form is on desktop so it can be smaller",
 * because the same contractor opens the same form on a phone.
 * ---------------------------------------------------------------------------
 */
/**
 * Everything except the border colour.
 *
 * Split out so a variant can set its own border without fighting the base for
 * it. Two Tailwind utilities for the same property are decided by their order
 * in the generated stylesheet, not by the order in the class attribute, so
 * "append an override" is a coin toss — and a silently wrong one.
 */
export const CONTROL_BASE =
  'block min-h-11 w-full rounded-lg border bg-white px-3.5 py-2.5 ' +
  'text-sm text-navy-900 transition-colors placeholder:text-navy-400 ' +
  'disabled:bg-navy-50 disabled:text-navy-400';

export const CONTROL_CLASS = `${CONTROL_BASE} border-navy-200 focus:border-navy-600`;

/** The same control when it is reporting a problem. */
export const CONTROL_INVALID_CLASS = 'border-red-400 focus:border-red-600';

export function controlClass(invalid = false, extra = ''): string {
  return [CONTROL_CLASS, invalid ? CONTROL_INVALID_CLASS : '', extra].filter(Boolean).join(' ');
}

/**
 * A labelled control.
 *
 * The label is a real `<label>` bound by `htmlFor`, so tapping it focuses the
 * field — which on a phone is a materially bigger target than the field's own
 * text. Required is marked in words as well as with the asterisk, because an
 * asterisk alone is a convention a screen reader reads as "star".
 */
export function FormField({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  /** Shown before anybody types. Guidance, not a rule being enforced. */
  hint?: string;
  /** Shown after a failed submit. Replaces the hint rather than stacking. */
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const described = error !== undefined ? `${id}-error` : hint !== undefined ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-navy-600">
        {label}
        {required === true && (
          <span className="text-red-600">
            {' '}
            *<span className="sr-only"> (required)</span>
          </span>
        )}
      </label>
      <div className="mt-1.5">{children}</div>
      {error !== undefined ? (
        // `role="alert"` so it is announced when it appears, which is the
        // moment it matters — not when the field is next focused.
        <p id={described} role="alert" className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      ) : (
        hint !== undefined && (
          <p id={described} className="mt-1.5 text-xs leading-relaxed text-navy-400">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export function TextInput({ invalid, className, ...props }: InputProps) {
  return <input {...props} className={controlClass(invalid, className ?? '')} />;
}

type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export function TextArea({ invalid, className, ...props }: TextAreaProps) {
  return <textarea {...props} className={controlClass(invalid, className ?? '')} />;
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export function SelectInput({ invalid, className, children, ...props }: SelectProps) {
  return (
    <select {...props} className={controlClass(invalid, className ?? '')}>
      {children}
    </select>
  );
}
