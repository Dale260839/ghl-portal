/**
 * Project names, shortened enough that a dropdown fits on a phone.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LABEL AND NOT THE CONTROL
 *
 * A native `<select>` popup is drawn by the browser, not by us. It cannot be
 * positioned, clipped or styled, and it sizes itself to its longest option. So
 * the only thing that decides whether it fits on a 320px screen is how long
 * the longest label is — `General Remodeling / Additions project in Bellevue
 * (+1 more)` is 59 characters and ran off the side of the screen.
 *
 * Replacing the select with a custom listbox would give us control and cost us
 * the native picker, which on a real phone is a better control than anything
 * we would build: it is full screen, it is familiar, and it works with the
 * accessibility tools already on the device.
 *
 * WHY THE MIDDLE AND NOT THE END
 *
 * These names end in the thing that distinguishes them. Truncating the tail
 * turns "…project in Bellevue" and "…project in Redmond" into the same string,
 * and a crew member files their day's work against the wrong house. Removing
 * the middle keeps both ends, which is where the meaning is.
 *
 * AND WHY IT CHECKS AFTERWARDS ANYWAY
 *
 * Middle-truncation makes a collision unlikely, not impossible. Two labels
 * that still come out identical are restored to their full length — a dropdown
 * that is too wide is a nuisance; two options a person cannot tell apart is a
 * wrong job.
 * ---------------------------------------------------------------------------
 */

/** Roughly what fits across a 320px screen at this control's size. */
export const MAX_OPTION_CHARS = 36;

const ELLIPSIS = '…';

export function shortenLabel(label: string, max: number = MAX_OPTION_CHARS): string {
  const text = label.trim();
  // Below this there is not enough of either end left to be worth keeping.
  if (max < 8 || text.length <= max) return text;

  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head).trimEnd()}${ELLIPSIS}${text.slice(text.length - tail).trimStart()}`;
}

/**
 * Shorten a whole set, keeping every one of them distinguishable.
 *
 * Labels that were already identical stay identical — nothing here can invent
 * a difference that the data does not have.
 */
export function distinctLabels(
  labels: readonly string[],
  max: number = MAX_OPTION_CHARS,
): string[] {
  const short = labels.map((label) => shortenLabel(label, max));

  // What each shortened label could have come from. More than one distinct
  // original behind the same short label means shortening MERGED two different
  // jobs, which is the only case worth undoing.
  //
  // Counting occurrences instead was the first attempt and was wrong: two jobs
  // genuinely sharing a name collide without shortening having done anything,
  // and restoring their full text makes them long again without making them
  // any easier to tell apart.
  const originsOf = new Map<string, Set<string>>();
  short.forEach((label, index) => {
    const origins = originsOf.get(label) ?? new Set<string>();
    origins.add(labels[index]!.trim());
    originsOf.set(label, origins);
  });

  return short.map((label, index) =>
    (originsOf.get(label)?.size ?? 0) > 1 ? labels[index]!.trim() : label,
  );
}

/** Ready-to-render options for a project `<select>`. */
export function projectOptions(
  projects: readonly { buildsuiteProjectId: string; projectName: string }[],
  max: number = MAX_OPTION_CHARS,
): { value: string; label: string; full: string }[] {
  const labels = distinctLabels(
    projects.map((p) => p.projectName),
    max,
  );
  return projects.map((project, index) => ({
    value: project.buildsuiteProjectId,
    label: labels[index]!,
    full: project.projectName,
  }));
}
