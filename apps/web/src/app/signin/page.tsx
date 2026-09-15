import { redirect } from 'next/navigation';

/**
 * RETIRED as a page — sign-in is one route, `/` (John, 2026-09-15).
 *
 * This was the homeowner's own door: email plus project code. The same two
 * fields now work on `/`, where the server tells a homeowner from a field
 * worker by what they typed. The route is kept as a redirect, not deleted,
 * because it has been handed out: earlier signature emails and anyone's
 * bookmark point here, and a 404 at the moment a homeowner first tries to see
 * their project is a phone call to the contractor.
 *
 * A message sent here with `?error=` is carried across rather than dropped.
 */
export default async function RetiredSignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const raw = (await searchParams).error;
  const error = Array.isArray(raw) ? raw[0] : raw;
  redirect(error !== undefined && error !== '' ? `/?error=${encodeURIComponent(error)}` : '/');
}
