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
};

export default nextConfig;
