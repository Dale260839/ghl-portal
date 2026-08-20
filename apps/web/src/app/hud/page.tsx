import type { Metadata } from 'next';

import { Hud } from './hud.tsx';

/**
 * The presenter HUD (`/hud`).
 *
 * Unauthenticated on purpose — it holds a script, not project data, and needing
 * a session would make it useless on the second device where it is most likely
 * to be opened. Kept out of search results all the same: it is an internal note
 * about how to sell, and it reads oddly to anyone else.
 */
export const metadata: Metadata = {
  title: 'Demo HUD — BuildSuite Project Hub',
  robots: { index: false, follow: false },
};

export default function HudPage() {
  return <Hud />;
}
