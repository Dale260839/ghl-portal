import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const stateModule = `export const state={denied:true,role:'contractor',checks:0,writes:[],can:true,projects:null,sourceKind:'buildsuite',projectExists:true,projectReadError:false,visibilityAvailable:true,visibilityError:false,visibilitySaves:[],projectReads:[],taskOwner:'member1'};`;
const session = `{role:'contractor',name:'Stale contractor',membershipId:'member1',authProfileIds:['profile1']}`;
const modules: Record<string,string> = {
  'next/cache': 'export function revalidatePath(){}',
  'next/navigation': 'export function redirect(url){throw new Error("REDIRECT:"+url);}',
  './session': `export async function getSession(){return ${session};} export function setSession(){} export function clearSession(){} export function homeFor(){} export function accountForEmail(){}`,
  './access.ts': `export async function requireAccess(){state.checks++;if(state.denied)throw new Error('access revoked');return {session:{...${session},role:state.role},role:state.role,projectIds:state.projects,can:()=>state.can};}`,
  './scope': `export async function actionTenantScope(){return {contractorId:'tenant1'};} export async function requireTenantScope(){return {contractorId:'tenant1'};}`,
  './data/current-source.ts': `export async function currentDataSource(){return {listDailyUpdates:async()=>[{id:'update1',projectId:'project1'}],listTasks:async()=>[{id:'task1',projectId:'project1',assignedTo:state.taskOwner}],getProject:async(scope,id)=>{state.projectReads.push({scope,id});if(state.projectReadError)throw new Error('ownership lookup unavailable');return state.projectExists?{projectName:'Pilot',clientPortalEnabled:false}:null;}};}`,
  './data/current-writer.ts': `export function currentWriter(){return {persistent:true,saveClientSummary:async()=>state.writes.push('summary'),setApproval:async()=>state.writes.push('approval'),returnForRevision:async()=>state.writes.push('return'),markTaskSeen:async()=>state.writes.push('seen')};}`,
  './data/source.ts': `export function activeSourceKind(){return state.sourceKind;}`,
  './hub-db/visibility': `export function getHubVisibility(){return state.visibilityAvailable?{available:true,visibility:{setVisibility:async(scope,id,switches,actor)=>{if(state.visibilityError)throw new Error('visibility storage unavailable');state.writes.push('visibility');state.visibilitySaves.push({scope,id,switches,actor});}}}:{available:false,missing:['Hub']};}`,
  './notify/homeowner.ts': `export async function notifyHomeowner(){state.writes.push('notify');return {sent:false};}`,
  './workflows/executor': `export async function execute(){} export function describe(){return 'isolated fixture';}`,
};

type Action = (...args: unknown[]) => Promise<unknown>;
interface State {
  denied:boolean;role:string;checks:number;writes:string[];can:boolean;projects:string[]|null;
  sourceKind:string;projectExists:boolean;projectReadError:boolean;visibilityAvailable:boolean;visibilityError:boolean;taskOwner:string;
  visibilitySaves:Array<{scope:{contractorId:string};id:string;switches:Record<string,boolean>;actor:{name:string;role:string}}>;
  projectReads:Array<{scope:{contractorId:string};id:string}>;
}

const operations = [
  'reviewUpdate','updateVisibility','markTaskSeen','editProjectDetails','archiveProject',
  'archiveRecord','restoreArchivedItem','revokeTeamMember','restoreTeamMember','inviteToProject',
  'addMemberToProject','removeMemberFromProject','resetMemberPassword','saveTeamProjects','saveTeamGrants',
  'saveInvoiceDraft','saveInvoiceTemplate','createInvoiceOnRail','createScheduleItem','updateScheduleItem',
  'archiveScheduleItem','createProjectTask','updateProjectTask','archiveProjectTask',
  'createMilestone','updateMilestone','archiveMilestone','createSelection','updateSelection',
  'archiveSelection','createChangeOrder','updateChangeOrder','archiveChangeOrder','recordClientDecision',
] as const;

async function harness(): Promise<{state:State;actions:Record<string,Action>;fixtureProjects:Array<Record<string,unknown>>}> {
  const root=dirname(fileURLToPath(import.meta.url));
  const output=await build({stdin:{contents:`export {${operations.join(',')}} from './actions.ts';export {PROJECTS as fixtureProjects} from './data/fixtures.ts';export {state} from 'access-fixture-state';`,resolveDir:root},
    absWorkingDir:resolve(root,'../..'),bundle:true,write:false,platform:'node',format:'esm',packages:'external',
    plugins:[{name:'isolated-mutation-access',setup(build){
      build.onResolve({filter:/^access-fixture-state$/},()=>({path:'state',namespace:'access-fixture'}));
      build.onResolve({filter:/.*/},args=>args.importer.endsWith('/lib/actions.ts')&&modules[args.path]!==undefined?{path:args.path,namespace:'access-fixture'}:undefined);
      build.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'access-fixture'}));
      build.onResolve({filter:/^[^./]/},args=>args.path.startsWith('node:')||args.path.startsWith('@/')||args.path==='@buildsuite/contracts'
        ? undefined : {path:pathToFileURL(require.resolve(args.path)).href,external:true});
      build.onLoad({filter:/.*/,namespace:'access-fixture'},args=>({contents:args.path==='state'?stateModule:args.path==='empty'?'':`import {state} from 'access-fixture-state';\n${modules[args.path]}`,loader:'js'}));
    }}],
  });
  const module=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.contents).toString('base64')}#${crypto.randomUUID()}`);
  const actions:Record<string,Action>={};
  for (const name of operations) actions[name]=async (...args)=>{
    try {return await module[name](...args);}
    catch (error) {if(error instanceof Error)error.stack=`${error.name}: ${error.message} (isolated mutation fixture)`;throw error;}
  };
  return {state:module.state,actions,fixtureProjects:module.fixtureProjects};
}

const previousStateActions = new Set(['inviteToProject','saveInvoiceTemplate','createScheduleItem','updateScheduleItem','createProjectTask','updateProjectTask']);

for (const name of operations) test(`${name} rechecks current access before using a stale contractor session`,async()=>{
  const {state,actions}=await harness();
  const form=new FormData();form.set('table','hub_tasks');form.set('id','record1');form.set('kind','selection');
  const args = previousStateActions.has(name) ? [undefined,form] : [form];
  await assert.rejects(actions[name]!(...args),/access revoked/);
  assert.equal(state.checks,1);
  assert.deepEqual(state.writes,[]);
});

test('a contractor demoted to field cannot review or publish with the old cookie role',async()=>{
  for (const action of ['save','internal','return','publish']) {
    const {state,actions}=await harness();state.denied=false;state.role='field';
    const form=new FormData();form.set('action',action);form.set('updateId','update1');
    await assert.rejects(actions.reviewUpdate!(form),/may not publish/);
    assert.deepEqual(state.writes,[]);
  }
});

test('a demoted contractor cannot approve selections using the old cookie role',async()=>{
  const {state,actions}=await harness();state.denied=false;state.role='field';
  const form=new FormData();form.set('kind','selection');
  await assert.rejects(actions.recordClientDecision!(form),/may not approve/);
  assert.deepEqual(state.writes,[]);
});

test('current contractor review actions still save, approve, return and publish',async()=>{
  for (const [action,writes] of Object.entries({save:['summary'],internal:['summary','approval'],return:['return'],publish:['summary','approval','notify']})) {
    const {state,actions}=await harness();state.denied=false;
    const form=new FormData();form.set('action',action);form.set('updateId','update1');form.set('clientSummary','Safe summary');
    await actions.reviewUpdate!(form);
    assert.equal(state.checks,1);assert.deepEqual(state.writes,writes);
  }
});

const projectUuid='bbd77380-ebc6-417f-8aaf-0f03150198dc';
function visibilityForm(projectId=projectUuid) {
  const form=new FormData();form.set('projectId',projectId);form.set('showPhotos','on');
  return form;
}

test('visibility refuses a project outside the contractor scope before any write',async()=>{
  const {state,actions}=await harness();state.denied=false;state.projectExists=false;
  await assert.rejects(actions.updateVisibility!(visibilityForm()),/project not found/);
  assert.deepEqual(state.projectReads,[{scope:{contractorId:'tenant1'},id:projectUuid}]);
  assert.deepEqual(state.writes,[]);
});

test('visibility refuses a project outside current assigned projects',async()=>{
  const {state,actions}=await harness();state.denied=false;state.projects=['other-project'];
  await assert.rejects(actions.updateVisibility!(visibilityForm()),/project not assigned/);
  assert.deepEqual(state.writes,[]);
});

test('live visibility cannot report saved when Hub storage is unavailable',async()=>{
  const {state,actions}=await harness();state.denied=false;state.visibilityAvailable=false;
  await assert.rejects(actions.updateVisibility!(visibilityForm()),/cannot be saved/i);
  assert.deepEqual(state.writes,[]);
});

test('live visibility refuses a fixture-shaped project ID',async()=>{
  const {state,actions}=await harness();state.denied=false;
  await assert.rejects(actions.updateVisibility!(visibilityForm('fixture-project')),/invalid project/i);
  assert.deepEqual(state.writes,[]);
});

test('owned live visibility saves the explicit switches under the caller tenant',async()=>{
  const {state,actions}=await harness();state.denied=false;
  await assert.rejects(actions.updateVisibility!(visibilityForm()),/REDIRECT:.*saved=1/);
  assert.deepEqual(state.writes,['visibility']);
  assert.equal(state.visibilitySaves.length,1);
  const saved=state.visibilitySaves[0]!;
  assert.deepEqual(saved.scope,{contractorId:'tenant1'});assert.equal(saved.id,projectUuid);
  assert.equal(saved.actor.role,'contractor');
  assert.equal(saved.switches.showPhotos,true);
  for (const [key,value] of Object.entries(saved.switches)) if(key!=='showPhotos')assert.equal(value,false,key);
});

test('visibility fails closed when project ownership cannot be read',async()=>{
  const {state,actions}=await harness();state.denied=false;state.projectReadError=true;
  await assert.rejects(actions.updateVisibility!(visibilityForm()),/ownership lookup unavailable/);
  assert.deepEqual(state.writes,[]);
});

test('visibility does not confirm success when the persistent save throws',async()=>{
  const {state,actions}=await harness();state.denied=false;state.visibilityError=true;
  await assert.rejects(actions.updateVisibility!(visibilityForm()),/visibility storage unavailable/);
  assert.deepEqual(state.writes,[]);
});

test('visibility rejects a demoted contractor before ownership lookup',async()=>{
  const {state,actions}=await harness();state.denied=false;state.role='field';
  await assert.rejects(actions.updateVisibility!(visibilityForm()),/may not update/);
  assert.deepEqual(state.projectReads,[]);assert.deepEqual(state.writes,[]);
});

test('explicit fixture mode still saves an owned demo project without live writes',async()=>{
  const {state,actions,fixtureProjects}=await harness();state.denied=false;state.sourceKind='fixture';state.visibilityAvailable=false;
  const project=fixtureProjects[0]!;
  const id=String(project.buildsuiteProjectId);
  await assert.rejects(actions.updateVisibility!(visibilityForm(id)),/REDIRECT:.*saved=1/);
  assert.equal(project.showPhotos,true);assert.equal(project.clientPortalEnabled,false);
  assert.deepEqual(state.projectReads,[{scope:{contractorId:'tenant1'},id}]);
  assert.deepEqual(state.writes,[]);
});

test('explicit fixture mode cannot change an unowned demo project',async()=>{
  const {state,actions,fixtureProjects}=await harness();state.denied=false;state.sourceKind='fixture';state.projectExists=false;
  const before=structuredClone(fixtureProjects[0]!);
  await assert.rejects(actions.updateVisibility!(visibilityForm(String(before.buildsuiteProjectId))),/project not found/);
  assert.deepEqual(fixtureProjects[0],before);assert.deepEqual(state.writes,[]);
});

test('crew cannot acknowledge a task on a no-longer-assigned project',async()=>{
  const {state,actions}=await harness();state.denied=false;state.role='field';state.projects=['other-project'];
  const form=new FormData();form.set('taskId','task1');
  await assert.rejects(actions.markTaskSeen!(form),/project not assigned/);
  assert.deepEqual(state.writes,[]);
});

test('assigned crew can still acknowledge their own task',async()=>{
  const {state,actions}=await harness();state.denied=false;state.role='field';state.projects=['project1'];
  const form=new FormData();form.set('taskId','task1');
  await actions.markTaskSeen!(form);
  assert.deepEqual(state.writes,['seen']);
});

test('assigned crew cannot acknowledge someone else\'s task',async()=>{
  const {state,actions}=await harness();state.denied=false;state.role='field';state.projects=['project1'];state.taskOwner='other-member';
  const form=new FormData();form.set('taskId','task1');
  await actions.markTaskSeen!(form);
  assert.deepEqual(state.writes,[]);
});
