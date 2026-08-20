/**
 * Mints two signed session cookies so `build-wireframes.mjs` can reach the
 * authenticated screens.
 *
 *   node scripts/mint-cookies.mjs
 *
 * Writes `.hud-cookies.json`, which is gitignored — it holds valid sessions.
 * Needs SESSION_SECRET to match the running server, so it reads the same
 * `.env.local` the dev server does.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { sign } from '../apps/web/src/lib/auth/session-crypto.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '..');

const env = readFileSync(resolve(REPO, 'apps/web/.env.local'), 'utf8');
const match = env.match(/^SESSION_SECRET=(.*)$/m);
if (match === null) throw new Error('SESSION_SECRET missing from apps/web/.env.local');
const secret = match[1].trim();

const TTL = 60 * 60 * 4;

const contractor = {
  role: 'contractor',
  name: 'Marcus Reyes',
  email: 'marcus@allianceproservices.com',
  authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40'],
  ghlLocationId: 'IifYfP2B2NUaoDPdsTTa',
};

const cookies = {
  staff: sign(contractor, secret, { ttlSeconds: TTL }),
  // The portal needs a client session; an assumed one is what a presenter uses.
  client: sign(
    {
      role: 'client',
      name: 'Dana Johnson',
      email: 'dana@example.com',
      contactId: 'contact-johnson',
      returnTo: contractor,
    },
    secret,
    { ttlSeconds: TTL },
  ),
};

writeFileSync(resolve(REPO, '.hud-cookies.json'), JSON.stringify(cookies, null, 2));
console.log('wrote .hud-cookies.json — valid for 4 hours');
