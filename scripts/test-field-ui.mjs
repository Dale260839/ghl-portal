import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssFolder = path.join(repo, 'apps/web/.next/static/css');
const css = (await Promise.all((await readdir(cssFolder)).filter(name => name.endsWith('.css'))
  .map(name => readFile(path.join(cssFolder,name),'utf8')))).join('\n');
const result = await build({
  absWorkingDir: path.join(repo, 'apps/web'), entryPoints: ['tests/field-ui-harness.tsx'],
  bundle: true, write: false, jsx: 'automatic', format: 'iife',
});
const server = createServer((req, res) => {
  if (req.url === '/styles.css') {
    res.setHeader('Content-Type','text/css');res.end(css);return;
  }
  if (req.url.startsWith('/api/files?')) {
    // Image fixture only: live file authorization is exercised elsewhere.
    res.setHeader('Content-Type','image/png');
    res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));return;
  }
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html');
  res.end(req.url === '/bundle.js' ? result.outputFiles[0].contents :
    '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles.css"><style>main{max-width:640px;margin:auto;padding:12px}label{display:block}input,textarea,select{border:1px solid #aaa}textarea{width:100%}</style><div id="root"></div><script src="/bundle.js"></script>');
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

  await page.getByLabel('Crew', {exact:true}).fill('3');
  await page.getByLabel('Hours', {exact:true}).fill('6.5');
  await page.getByLabel('Weather', {exact:true}).fill('Rain');
  await page.getByLabel('Client decision needed', {exact:true}).check();

  const file = { name: 'site.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') };
  await page.locator('input[type=file]').last().setInputFiles(file);
  await page.getByText('Retrying…', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /still uploading/ }).isEnabled(), false);
  assert.equal(await page.getByLabel('Project').isEnabled(), false);
  await page.getByText('Saved', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Send update' }).click();
  await page.waitForFunction(() => document.querySelector('output').textContent.includes('test-photo-2'));
  const posted = JSON.parse(await page.locator('output').innerText());
  assert.equal(posted.projectId, 'p1');
  assert.equal(posted.photoId, 'test-photo-2');

  const recoveredDraft = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bs_field_draft:v2:one')));
  assert.deepEqual(recoveredDraft.photoIds, ['test-photo-2']);
  await page.reload();
  await page.getByRole('button', { name: 'Bring it back' }).click();
  assert.equal(await page.getByLabel('Internal notes').inputValue(), 'Private notes for user one');
  assert.equal(await page.getByLabel('Crew', {exact:true}).inputValue(), '3');
  assert.equal(await page.getByLabel('Hours', {exact:true}).inputValue(), '6.5');
  assert.equal(await page.getByLabel('Weather', {exact:true}).inputValue(), 'Rain');
  assert.equal(await page.getByLabel('Client decision needed', {exact:true}).isChecked(), true);
  assert.equal(await page.getByLabel('Project').isEnabled(), false);
  assert.equal(await page.locator('input[name=photoId]').count(), 1);
  await mkdir(path.join(repo, '.artifacts'), {recursive:true});
  await page.waitForFunction(() => {
    const image=document.querySelector('img[alt="Saved draft photo"]');
    return image?.complete && image.naturalWidth>0;
  });
  for (const [width,height] of [[390,844],[1440,900]]) {
    await page.setViewportSize({width,height});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true);
    const tile = await page.locator('img[alt="Saved draft photo"]').boundingBox();
    const detach = await page.getByRole('button',{name:'Detach photo from draft'}).boundingBox();
    assert.ok(detach.x>=tile.x && detach.x+detach.width<=tile.x+tile.width && detach.y>=tile.y && detach.y+detach.height<=tile.y+tile.height);
    await page.screenshot({path:path.join(repo,`.artifacts/draft-recovery-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button', { name: 'Change user' }).click();
  assert.equal(await page.locator('input[name=photoId]').count(), 0);
  await page.getByRole('button', { name: 'Change user' }).click();
  await page.getByRole('button', { name: 'Bring it back' }).click();
  await page.getByRole('button', { name: 'Send update' }).click();
  assert.deepEqual(JSON.parse(await page.locator('output').innerText()).photoIds, ['test-photo-2']);

  await page.getByRole('button', {name:'Detach photo from draft'}).click();
  assert.equal(await page.locator('input[name=photoId]').count(),0);
  assert.equal(await page.getByLabel('Project').isEnabled(),true);
  assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('bs_field_draft:v2:one')).photoIds),[]);
  assert.equal(await page.getByLabel('Internal notes').inputValue(),'Private notes for user one');
  await page.getByRole('button', {name:'Successful update landing'}).click();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('bs_field_draft:v2:one')),null);
  await page.getByRole('button', {name:'New daily update'}).click();
  assert.equal(await page.locator('input[name=photoId]').count(),0);

  await page.getByLabel('Internal notes').fill('New unsent update after the previous success');
  const newerDraft = await page.evaluate(() => sessionStorage.getItem('bs_field_draft:v2:one'));
  await page.getByRole('button', {name:'Revisit previous success'}).click();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('bs_field_draft:v2:one')),newerDraft,
    'an old success landing must not clear a newer unsent update');
  await page.getByRole('button', {name:'New daily update'}).click();
  await page.getByRole('button', {name:'Bring it back'}).click();
  assert.equal(await page.getByLabel('Internal notes').inputValue(),'New unsent update after the previous success');
  await page.getByRole('button', {name:'Successful update landing'}).click();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('bs_field_draft:v2:one')),null);
  await page.getByRole('button', {name:'New daily update'}).click();

  // Upload completion alone creates a recoverable draft: no typing event is needed.
  await page.locator('input[type=file]').last().setInputFiles(file);
  await page.getByText('Saved', {exact:true}).waitFor();
  const photoOnly = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bs_field_draft:v2:one')));
  assert.equal(photoOnly.photoIds.length,1);
  await page.reload();
  await page.getByRole('button', {name:'Bring it back'}).click();
  assert.equal(await page.locator('input[name=photoId]').count(),1);
  assert.equal(await page.getByLabel('Internal notes').inputValue(),'');
  await page.getByRole('button', {name:'Successful update landing'}).click();
  await page.getByRole('button', {name:'New daily update'}).click();

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

  await page.reload();
  await page.locator('input[type=file]').last().setInputFiles(
    Array.from({ length: 12 }, (_, index) => ({ ...file, name: `batch-${index}.png` })));
  await page.getByRole('button', { name: /still uploading/ }).waitFor();
  assert.equal(await page.getByLabel('Project').isEnabled(), false);
  await page.getByText('12 photos saved to the job.', { exact: true }).waitFor({ timeout: 15_000 });
  assert.equal(await page.locator('input[name=photoId]').count(), 12);
  await page.getByRole('button', { name: 'Send update' }).click();
  const batch = JSON.parse(await page.locator('output').innerText());
  assert.equal(batch.projectId, 'p1');
  assert.equal(new Set(batch.photoIds).size, 12);

  for (const values of [
    { savedAt: new Date(Date.now() - 86_400_001).toISOString(), values: { projectId: 'p1', internalNotes: 'Expired draft' } },
    { savedAt: new Date(Date.now() + 3_600_000).toISOString(), values: { projectId: 'p1', internalNotes: 'Future draft' } },
  ]) {
    await page.evaluate((draft) => sessionStorage.setItem('bs_field_draft:v2:one', JSON.stringify(draft)), values);
    await page.reload();
    assert.equal(await page.getByRole('button', { name: 'Bring it back' }).count(), 0);
    assert.equal(await page.getByLabel('Internal notes').inputValue(), '');
  }
  await page.evaluate(() => sessionStorage.setItem('bs_field_draft:v2:one', '{broken'));
  await page.reload();
  assert.equal(await page.getByRole('button', { name: 'Bring it back' }).count(), 0);
  await page.evaluate(() => sessionStorage.setItem('bs_field_draft:v2:one', JSON.stringify({
    savedAt: new Date().toISOString(), values: { projectId: 'removed-project', internalNotes: 'Wrong project draft' },
  })));
  await page.reload();
  await page.getByRole('button', { name: 'Bring it back' }).click();
  assert.equal(await page.getByLabel('Project').inputValue(), 'p1');
  assert.equal(await page.getByLabel('Internal notes').inputValue(), '');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('bs_field_draft:v2:one')), null);

  await page.getByRole('button', { name: 'Task mode', exact: true }).click();
  await page.getByLabel('What did you do?').fill('Task photo software test');
  await page.getByRole('combobox', { name: /Status/ }).selectOption('In Progress');
  await page.locator('input[type=file]').last().setInputFiles(file);
  await page.getByText('Retrying\u2026', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /still uploading/ }).isEnabled(), false);
  await page.getByText('Saved', { exact: true }).waitFor();
  assert.equal(await page.locator('input[name=photoId]').count(), 1);
  await page.getByRole('button', { name: 'Send update to PM', exact: true }).click();
  await page.getByText('Nothing submitted; try again later', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('What did you do?').inputValue(), 'Task photo software test');
  assert.equal(await page.getByRole('combobox', { name: /Status/ }).inputValue(), 'In Progress');
  assert.equal(await page.locator('input[name=photoId]').count(), 1);
  await page.getByLabel('Reject task submission').uncheck();
  await page.getByRole('button', { name: 'Send update to PM', exact: true }).click();
  await page.getByText('Task update saved', { exact: true }).waitFor();
  const taskPosted = JSON.parse(await page.locator('output').innerText());
  assert.equal(taskPosted.taskId, 'task1');
  assert.deepEqual(taskPosted.photoIds, ['test-photo-2']);
  assert.equal(taskPosted.photoCount, '1');
  assert.equal(await page.locator('input[name=photoId]').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Send update to PM', exact: true }).isEnabled(), true);
  assert.equal(await page.getByLabel('What did you do?').inputValue(), '');
  assert.equal(await page.getByRole('combobox', { name: /Status/ }).inputValue(), '');
  await page.getByLabel('What did you do?').fill('Second update, no new photos');
  await page.getByRole('button', { name: 'Send update to PM', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('output').textContent.includes('Second update'));
  const secondTaskPosted = JSON.parse(await page.locator('output').innerText());
  assert.deepEqual(secondTaskPosted.photoIds, []);
  assert.equal(secondTaskPosted.photoCount, '0');
  assert.deepEqual(errors, []);
  await mkdir(path.join(repo, '.artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(repo, '.artifacts/field-ui-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(repo, '.artifacts/field-ui-desktop.png') });
  console.log('PASS: real React retry/submit controls, 12-photo queue, unique photo links, per-user drafts, all daily values and saved photos restored after reload, photo-only draft recovery, detach without losing text, matching successful draft cleanup and old success landing preserves newer draft, expired/future/corrupt drafts, removed-project restoration, rejected task submission retention, and task retry gating/reset without repeated photo IDs.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
