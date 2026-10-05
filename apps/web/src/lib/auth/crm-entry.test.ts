import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Params = Record<string, string | string[] | undefined>;
type Page = (input: { searchParams: Promise<Params> }) => Promise<{
  props: { locationId: string; signedQuery: string; parentOrigins: string[] };
}>;

async function harness(): Promise<{ crm: Page; ghl: Page }> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const output = await build({
    stdin: {
      contents: `export {default as crm} from './src/app/auth/crm/page.tsx';
        export {default as ghl} from './src/app/auth/ghl/page.tsx';`,
      resolveDir: root,
    },
    absWorkingDir: root, bundle: true, write: false, platform: 'node',
    format: 'esm', jsx: 'automatic',
    plugins: [{ name: 'entry-component-fixture', setup(builder) {
      builder.onResolve({ filter: /^\.\/connecting$/ }, () => ({
        path: 'connecting', namespace: 'entry-fixture',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'entry-fixture' }, () => ({
        contents: 'export function Connecting(){return null;}', loader: 'js',
      }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.contents).toString('base64')}`);
}

test('white-label CRM entry reuses exactly the existing authentication page', async () => {
  const { crm, ghl } = await harness();
  assert.equal(crm, ghl);
});

test('CRM entry preserves signed claims and trusted parent origins', async () => {
  const { crm } = await harness();
  const rendered = await crm({ searchParams: Promise.resolve({
    locationId: 'location-test', userId: 'user-test', email: 'test@example.test',
    timestamp: '1800000000', signature: 'fixture-signature', extra: 'ignored',
  }) });
  assert.equal(rendered.props.locationId, 'location-test');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(rendered.props.signedQuery)), {
    locationId: 'location-test', userId: 'user-test', email: 'test@example.test',
    timestamp: '1800000000', signature: 'fixture-signature',
  });
  const expected = (process.env.GHL_PARENT_ORIGINS ??
    'https://app.gohighlevel.com,https://app.allianceforcontractors.com')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  assert.deepEqual(rendered.props.parentOrigins, expected);
});

test('CRM entry neither invents a location nor accepts array-valued signed claims', async () => {
  const { crm } = await harness();
  const absent = await crm({ searchParams: Promise.resolve({}) });
  assert.equal(absent.props.locationId, '');
  assert.equal(absent.props.signedQuery, '');
  const arrays = await crm({ searchParams: Promise.resolve({
    locationId: ['location-test', 'another'], signature: ['forged'],
  }) });
  assert.equal(arrays.props.locationId, 'location-test');
  assert.equal(arrays.props.signedQuery, '');
});
