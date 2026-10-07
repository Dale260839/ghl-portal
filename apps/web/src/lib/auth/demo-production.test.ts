import assert from 'node:assert/strict';
import test from 'node:test';
import { demoSignInEnabled } from '../demo-accounts.ts';

function enabled(nodeEnv: NodeJS.ProcessEnv['NODE_ENV'], flag: string | undefined): boolean {
  const original = process.env;
  try {
    process.env = { ...original, NODE_ENV: nodeEnv };
    if (flag === undefined) delete process.env.ENABLE_DEMO_SIGNIN;
    else process.env.ENABLE_DEMO_SIGNIN = flag;
    return demoSignInEnabled();
  } finally { process.env = original; }
}

test('production refuses demo sign-in even when the demo flag is accidentally enabled', () => {
  for (const flag of [undefined, 'false', 'true', '1']) assert.equal(enabled('production', flag), false);
});

test('local demo sign-in still requires the exact opt-in flag', () => {
  assert.equal(enabled('development', 'true'), true);
  for (const flag of [undefined, 'false', '1', 'TRUE']) assert.equal(enabled('development', flag), false);
});
