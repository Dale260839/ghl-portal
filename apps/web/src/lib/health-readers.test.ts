import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HealthReport } from './health.ts';

interface State {
  hubError: unknown;
  buildsuiteError: unknown;
  columnError: unknown;
  probes: string[];
}

async function harness(): Promise<{
  state: State;
  healthReport: (env?: NodeJS.ProcessEnv) => Promise<HealthReport>;
}> {
  const root = dirname(fileURLToPath(import.meta.url));
  const modules: Record<string, string> = {
    './hub-db/client.ts': `export function getHubClient(){return {available:true,client:{select:async(args)=>{
      state.probes.push(args.from);
      const error=args.from==='hub_project_state'?state.hubError:state.columnError;
      if(error!==null)throw error;return [];
    }}};}`,
    './buildsuite/projects.ts': `export function getBuildSuiteReader(){return {available:true,listAuthProfileIdsForLocation:async()=>{
      if(state.buildsuiteError!==null)throw state.buildsuiteError;return [];
    }};}`,
  };
  const output = await build({
    stdin: { contents: `export {healthReport} from './health.ts';export {state} from 'health-fixture';`, resolveDir: root },
    absWorkingDir: resolve(root, '../..'), bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'isolated-health-reads', setup(builder) {
      builder.onResolve({ filter: /^health-fixture$/ }, () => ({ path: 'state', namespace: 'health-fixture' }));
      builder.onResolve({ filter: /^server-only$/ }, () => ({ path: 'empty', namespace: 'health-fixture' }));
      builder.onResolve({ filter: /.*/ }, (args) => args.importer.endsWith('/lib/health.ts') && modules[args.path]
        ? { path: args.path, namespace: 'health-fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'health-fixture' }, (args) => ({
        contents: args.path === 'state'
          ? 'export const state={hubError:null,buildsuiteError:null,columnError:null,probes:[]};'
          : args.path === 'empty' ? '' : `import {state} from 'health-fixture';${modules[args.path]}`,
        loader: 'js',
      }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.contents).toString('base64')}#${crypto.randomUUID()}`);
}

const configured = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  SESSION_SECRET: 's'.repeat(32),
  GHL_API_BASE_URL: 'https://example.test', GHL_API_VERSION: '2021-07-28',
  GHL_PRIVATE_INTEGRATION_TOKEN: 'private-value',
});

test('health never echoes database error text or customer data', async () => {
  const { state, healthReport } = await harness();
  for (const failure of ['buildsuiteError', 'hubError', 'columnError'] as const) {
    state[failure] = { status: 503, message: 'private-value customer@example.test private proposal' };
    const report = await healthReport(configured());
    const text = JSON.stringify(report);
    assert.equal(report.state, 'fail');
    assert.match(text, /HTTP 503/);
    for (const privateText of ['private-value', 'customer@example.test', 'private proposal']) {
      assert.equal(text.includes(privateText), false);
    }
    state[failure] = null;
  }
});

test('health handles non-Error failures without throwing or printing them', async () => {
  const { state, healthReport } = await harness();
  state.buildsuiteError = 'private transport details';
  state.columnError = { status: 'customer@example.test' };
  const report = await healthReport(configured());
  assert.equal(report.state, 'fail');
  assert.equal(JSON.stringify(report).includes('private transport details'), false);
  assert.equal(JSON.stringify(report).includes('customer@example.test'), false);
});

test('migration column outage is failure, not a claim that migrations never ran', async () => {
  const { state, healthReport } = await harness();
  state.columnError = { status: 401, message: 'permission denied' };
  const report = await healthReport(configured());
  const migrations = report.checks.filter((check) => check.name.startsWith('migration-'));
  assert.equal(migrations.length, 4);
  assert.ok(migrations.every((check) => check.state === 'fail'));
  assert.ok(migrations.every((check) => /availability unconfirmed/.test(check.detail)));
  assert.equal(JSON.stringify(migrations).includes('NOT RUN'), false);
});

test('health probes columns afresh and recognizes recovery in the same process', async () => {
  const { state, healthReport } = await harness();
  state.columnError = { status: 503 };
  await healthReport(configured());
  state.columnError = null;
  const recovered = await healthReport(configured());
  assert.ok(recovered.checks.filter((check) => check.name.startsWith('migration-')).every((check) => check.state === 'ok'));
  assert.equal(state.probes.filter((table) => table === 'hub_photos').length, 4);
  assert.match(recovered.checks.find((check) => check.name === 'migration-0019')!.detail, /full migration state not verified/);
});

test('secure entry and webhook configuration never masquerade as executed workflows', async () => {
  const { healthReport } = await harness();
  const report = await healthReport({ ...configured(), GHL_WEBHOOK_ED25519_PUBLIC_KEY: 'public-key' });
  assert.match(report.checks.find((check) => check.name === 'menu-link-signing')!.detail, /unsigned location links are refused/);
  const webhook = report.checks.find((check) => check.name === 'webhooks')!;
  assert.equal(webhook.state, 'warn');
  assert.match(webhook.detail, /verification configuration present/);
  assert.match(webhook.detail, /execution unavailable/);
  assert.equal(report.checks.find((check) => check.name === 'ghl-user-context')!.state, 'warn');
  const configuredSso = await healthReport({ ...configured(), GHL_APP_SHARED_SECRET: 'private-context', GHL_SSO_COMPANY_ID: 'company' });
  assert.match(configuredSso.checks.find((check) => check.name === 'ghl-user-context')!.detail, /handshake not verified/);
  assert.equal(JSON.stringify(configuredSso).includes('private-context'), false);
});

test('OAuth credentials do not falsely require a fallback Private Integration token', async () => {
  const { healthReport } = await harness();
  const report = await healthReport({
    NODE_ENV: 'test',
    SESSION_SECRET: 's'.repeat(32), GHL_OAUTH_ENABLED: 'true',
    GHL_OAUTH_CLIENT_ID: 'app', GHL_OAUTH_CLIENT_SECRET: 'private-client-secret',
    GHL_OAUTH_REDIRECT_URI: 'https://example.test/callback',
  });
  const credentials = report.checks.find((check) => check.name === 'ghl-credentials')!;
  assert.equal(credentials.state, 'ok');
  assert.match(credentials.detail, /validity and installation not verified/);
  assert.equal(JSON.stringify(report).includes('private-client-secret'), false);
});
