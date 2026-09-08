/**
 * The short code shown beside "Project Hub" in the shell.
 *
 * Chris, 8 Sep: "right here would say APS … that's going to be their code. Or it
 * will just have the person's logo and then the code and then Project Hub."
 * BuildSuite holds no contractor code, so the code is the business name's
 * initials: "Alliance Pro Services" → "APS", "Priority Electric LLC" → "PE".
 * Legal suffixes are dropped so they never become letters, and a one-word name
 * takes its first three letters. Pure, so it is unit-tested.
 */
const LEGAL_SUFFIXES = new Set([
  'llc',
  'l.l.c',
  'inc',
  'ltd',
  'co',
  'corp',
  'company',
  'pty',
  'plc',
  'limited',
  'incorporated',
]);

export function brandCode(name: string | null | undefined, fallback = 'APS'): string {
  const words = (name ?? '')
    .split(/[\s&/,+-]+/)
    .map((w) => w.trim().replace(/\.+$/, ''))
    .filter((w) => w !== '' && !LEGAL_SUFFIXES.has(w.toLowerCase()));

  if (words.length === 0) return fallback;
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();

  const letters = words
    .map((w) => w[0]!.toUpperCase())
    .filter((c) => /[A-Z0-9]/.test(c))
    .slice(0, 3)
    .join('');
  return letters.length >= 2 ? letters : fallback;
}
