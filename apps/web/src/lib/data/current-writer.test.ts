import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

async function writerHarness(kind: 'fixture' | 'buildsuite' | 'ghl', available: boolean) {
  const replacements: Record<string, string> = {
    'server-only': '',
    '../hub-db/operational.ts': `export function getHubOperational(){return ${available
      ? '{available:true,ops:{createUpdate:async()=>({id:"saved-live"})}}'
      : '{available:false,missing:["HUB_SUPABASE_KEY"]}'};}`,
    './source.ts': `export function activeSourceKind(){return '${kind}';}`,
    './mutations.ts': `export function createDraftUpdate(){return 'demo-only';}
      export function approveInternally(){} export function returnForRevision(){} export function saveClientSummary(){}`,
  };
  const output = await build({
    entryPoints: [fileURLToPath(new URL('./current-writer.ts', import.meta.url))],
    absWorkingDir: dirname(fileURLToPath(import.meta.url)),
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'isolated-writer', setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => replacements[args.path] !== undefined
        ? { path: args.path, namespace: 'writer-fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'writer-fixture' }, (args) => ({ contents: replacements[args.path], loader: 'js' }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.contents).toString('base64')}`) as Promise<{
    currentWriter: () => { persistent: boolean; createUpdate: (...args: unknown[]) => Promise<string> };
  }>;
}

test('an unavailable live writer refuses instead of saving into demo memory', async () => {
  for (const kind of ['buildsuite', 'ghl'] as const) {
    const { currentWriter } = await writerHarness(kind, false);
    assert.throws(() => currentWriter(), /Nothing was saved/);
  }
});

test('an available live writer saves through Hub operations', async () => {
  const { currentWriter } = await writerHarness('buildsuite', true);
  const writer = currentWriter();
  assert.equal(writer.persistent, true);
  assert.equal(await writer.createUpdate({}, {}), 'saved-live');
});

test('the explicit fixture data source retains its isolated demo writer', async () => {
  const { currentWriter } = await writerHarness('fixture', false);
  const writer = currentWriter();
  assert.equal(writer.persistent, false);
  assert.equal(await writer.createUpdate({}, {}), 'demo-only');
});
