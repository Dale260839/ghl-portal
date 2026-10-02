import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const stateModule = `export const state = {
  photos: [{id:'photo1', projectId:'p1', taskId:'task1', updateId:null}],
  events: [], updates: [], notifications: [], links: [],
  mediaAvailable:true, readFailure:false, linkFailure:false, linkCount:null,
};`;
const modules: Record<string, string> = {
  'next/cache': `export function revalidatePath() {}`,
  '../hub-db/upload-budget.ts': `export class UploadBudgetError extends Error {} export function uploadActor(){return 'actor';}`,
  '../access.ts': `export async function requireAccess(){return {role:'field',session:{name:'Crew',membershipId:'crew1'},projectIds:['p1'],can:()=>true};}`,
  '../permissions.ts': `export function assertCan(){} export function ownsTask(){return true;}`,
  '../scope.ts': `export async function actionTenantScope(){return {contractorId:'tenant1',authProfileId:'profile1',locationId:'location1'};}`,
  '../data/current-source.ts': `export async function currentDataSource(){return {
    listProjects:async()=>[{buildsuiteProjectId:'p1',projectName:'Pilot'}],
    listTasks:async()=>[{id:'task1',projectId:'p1',taskName:'Pilot task',status:'Not Started',seenAt:'seen'}]
  };}`,
  '../data/current-writer.ts': `export function currentWriter(){return {
    createUpdate:async(scope,input)=>{state.events.push('create');state.updates.push(input);return 'update1';},
    setTaskStatus:async()=>{state.events.push('status');},
    markTaskSeen:async()=>{state.events.push('seen');}
  };}`,
  '../field-scope.ts': `export function fieldProjectsFor(access,projects){return projects;}`,
  '../field-data.ts': `export function tasksForField(tasks){return tasks;}`,
  '../hub-db/media.ts': `export function getHubMedia(){return state.mediaAvailable ? {available:true,media:{
    listForTask:async(scope,kind,taskId)=>{state.events.push('check');if(state.readFailure)throw Object.assign(Error('read failed'),{stack:'Error: read failed (isolated fixture)'});return state.photos.filter(p=>p.taskId===taskId);},
    linkToUpdate:async(scope,kind,ids,updateId,projectId)=>{state.events.push('link');state.links.push({scope,kind,ids,updateId,projectId});if(state.linkFailure)throw Object.assign(Error('link failed'),{stack:'Error: link failed (isolated fixture)'});return state.linkCount ?? ids.length;}
  }} : {available:false,missing:['test']};}`,
  '../hub-db/storage.ts': `export function getHubStorage(){return {available:false};}`,
  '../notify/pm.ts': `export async function notifyPmOfFieldSubmission(scope,input){state.events.push('notify');state.notifications.push(input);return {sent:true,reason:'sent'};}`,
  '../workflows/executor.ts': `export async function execute(){return [];} export function describe(){return '';}`,
  '../workflows/fixture-ports.ts': `export const fixturePorts={};`,
  '../workflows/wf3-update-submitted.ts': `export function planFieldUpdateSubmitted(){return [];}`,
};

interface State {
  photos: { id: string; projectId: string; taskId: string; updateId: string | null }[];
  events: string[];
  updates: { workCompleted: string }[];
  notifications: { photoCount: number }[];
  links: { ids: string[]; updateId: string; projectId: string }[];
  mediaAvailable: boolean;
  readFailure: boolean;
  linkFailure: boolean;
  linkCount: number | null;
}

async function harness(): Promise<{
  state: State;
  postTaskUpdate: (previous: undefined, data: FormData) => Promise<{ notice: string; reset?: boolean }>;
}> {
  const output = await build({
    stdin: {
      contents: "export {postTaskUpdate} from './actions/field-tasks.ts'; export {state} from 'task-fixture-state';",
      resolveDir: dirname(fileURLToPath(import.meta.url)),
    },
    bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external',
    plugins: [{ name: 'isolated-task-action', setup(build) {
      build.onResolve({ filter: /^task-fixture-state$/ }, () => ({ path: 'state', namespace: 'task-fixture' }));
      build.onResolve({ filter: /.*/ }, (args) =>
        args.importer.endsWith('/actions/field-tasks.ts') && modules[args.path] !== undefined
          ? { path: args.path, namespace: 'task-fixture' } : undefined);
      build.onLoad({ filter: /.*/, namespace: 'task-fixture' }, (args) => ({
        contents: args.path === 'state' ? stateModule : `import {state} from 'task-fixture-state';\n${modules[args.path]}`,
        loader: 'js',
      }));
    } }],
  });
  // Each bundle is isolated; no request or production credential is involved.
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.contents).toString('base64')}#${crypto.randomUUID()}`);
}

function form(ids: string[] = ['photo1']): FormData {
  const data = new FormData();
  data.set('taskId', 'task1');
  data.set('text', 'Software test only');
  data.set('photoCount', '999');
  ids.forEach((id) => data.append('photoId', id));
  return data;
}

test('task submission links only saved task photo IDs to its newly created update', async () => {
  const action = await harness();
  const result = await action.postTaskUpdate(undefined, form(['photo1', 'photo1']));
  assert.deepEqual(action.state.events, ['check', 'create', 'link', 'notify']);
  assert.deepEqual(action.state.links[0]?.ids, ['photo1']);
  assert.equal(action.state.links[0]?.updateId, 'update1');
  assert.equal(action.state.links[0]?.projectId, 'p1');
  assert.match(action.state.updates[0]!.workCompleted, /1 photo added/);
  assert.equal(action.state.notifications[0]?.photoCount, 1);
  assert.match(result.notice, /with 1 photo/);
});

test('a forged photo count without saved IDs does not claim photographs', async () => {
  const action = await harness();
  const result = await action.postTaskUpdate(undefined, form([]));
  assert.equal(action.state.links.length, 0);
  assert.equal(action.state.notifications[0]?.photoCount, 0);
  assert.doesNotMatch(action.state.updates[0]!.workCompleted, /photo/);
  assert.doesNotMatch(result.notice, /with .*photo/);
});

test('another task, another project, and an already-linked photo are refused before any write', async () => {
  for (const photo of [
    { id: 'photo1', projectId: 'p1', taskId: 'other-task', updateId: null },
    { id: 'photo1', projectId: 'other-project', taskId: 'task1', updateId: null },
    { id: 'photo1', projectId: 'p1', taskId: 'task1', updateId: 'previous-update' },
  ]) {
    const action = await harness();
    action.state.photos = [photo];
    const data = form();
    data.set('status', 'In Progress');
    const result = await action.postTaskUpdate(undefined, data);
    assert.match(result.notice, /not available/);
    assert.equal(result.reset, false);
    assert.deepEqual(action.state.events, ['check']);
    assert.equal(action.state.updates.length, 0);
    assert.equal(action.state.notifications.length, 0);
  }
});

test('a failed photo preflight does not create an update or change task status', async () => {
  for (const mode of ['unavailable', 'read-failure']) {
    const action = await harness();
    action.state.mediaAvailable = mode !== 'unavailable';
    action.state.readFailure = mode === 'read-failure';
    const result = await action.postTaskUpdate(undefined, form());
    assert.match(result.notice, /cannot be checked|could not be checked/);
    assert.equal(result.reset, false);
    assert.equal(action.state.updates.length, 0);
    assert.equal(action.state.links.length, 0);
  }
});

test('link failure preserves the update and truthfully warns instead of reporting attached photos', async () => {
  for (const mode of ['throw', 'partial']) {
    const action = await harness();
    action.state.linkFailure = mode === 'throw';
    action.state.linkCount = mode === 'partial' ? 0 : null;
    const result = await action.postTaskUpdate(undefined, form());
    assert.equal(action.state.updates.length, 1);
    assert.equal(action.state.notifications[0]?.photoCount, 0);
    assert.match(result.notice, /could not be linked/);
    assert.match(result.notice, /do not resend the update/);
    assert.doesNotMatch(result.notice, /with 1 photo/);
  }
});
