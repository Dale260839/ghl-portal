import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  absWorkingDir: path.join(repo, 'apps/web'), entryPoints: ['tests/field-ui-harness.tsx'],
  bundle: true, write: false, jsx: 'automatic', format: 'iife',
});
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html');
  res.end(req.url === '/bundle.js' ? result.outputFiles[0].contents :
    '<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByLabel('Internal notes').fill('Private notes for user one');
  assert.match(await page.evaluate(() => sessionStorage.getItem('bs_field_draft:v2:one')), /Private notes/);
  await page.getByRole('button', { name: 'Change user' }).click();
  assert.equal(await page.getByLabel('Internal notes').inputValue(), '');
  assert.equal(await page.getByRole('button', { name: 'Bring it back' }).count(), 0);
  await page.getByRole('button', { name: 'Change user' }).click();
  await page.getByRole('button', { name: 'Bring it back' }).click();
  assert.equal(await page.getByLabel('Internal notes').inputValue(), 'Private notes for user one');

  const file = { name: 'site.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3]) };
  await page.locator('input[type=file]').last().setInputFiles(file);
  await page.getByText('Retrying…', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /still uploading/ }).isEnabled(), false);
  assert.equal(await page.getByLabel('Project').isEnabled(), false);
  await page.getByText('Saved', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Send update' }).click();
  const posted = JSON.parse(await page.locator('output').innerText());
  assert.equal(posted.projectId, 'p1');
  assert.equal(posted.photoId, 'test-photo');

  await page.reload();
  await page.getByLabel('Fail all uploads').check();
  await page.locator('input[type=file]').last().setInputFiles(file);
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor({ timeout: 15_000 });
  assert.equal(await page.getByRole('button', { name: 'Send update' }).isEnabled(), true);
  await page.getByLabel('Fail all uploads').uncheck();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('button', { name: /still uploading/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /still uploading/ }).isEnabled(), false);
  await page.getByText('Saved', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await mkdir(path.join(repo, '.artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(repo, '.artifacts/field-ui-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(repo, '.artifacts/field-ui-desktop.png') });
  console.log('PASS: actual React components block retry submission, preserve project identity, and isolate user drafts.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
