import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // @buildsuite/contracts ships raw TypeScript with .ts import specifiers, so it
  // has to go through the app's compiler rather than be consumed as built JS.
  transpilePackages: ['@buildsuite/contracts'],
  // Monorepo: the workspace root is one level up from apps/web.
  outputFileTracingRoot: path.join(here, '../../'),
  experimental: {
    serverActions: {
      // Next's default is 1 MB, which no phone photo fits under. Photos are
      // shrunk in the browser first (lib/field-task.ts); this is the backstop,
      // kept under Vercel's 4.5 MB request cap.
      bodySizeLimit: '4mb',
    },
  },
};

export default nextConfig;
