import { Connecting } from './connecting';

/**
 * The authenticating page — what a contractor sees between clicking the menu
 * item in GoHighLevel and landing on their dashboard.
 *
 * BuildSuite shows the same moment, and it earns its place: verifying a location
 * and resolving an agency takes a second or two of real network work. Without a
 * page there, the browser sits on a blank white screen and the product looks
 * broken before it has rendered anything.
 *
 * The work still happens server-side in `/api/auth/ghl`. This is only the face
 * on it — which matters, because the face is the part that must never imply
 * success before the verification has actually passed.
 */
export default async function GhlAuthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.locationId;
  const locationId = Array.isArray(raw) ? raw[0] : raw;

  return <Connecting locationId={locationId ?? ''} />;
}
