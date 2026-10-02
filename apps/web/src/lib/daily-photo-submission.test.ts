import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const stateModule = `export const state={photos:[{id:'photo1',projectId:'p1',updateId:null}],events:[],links:[],notifications:[],mediaAvailable:true,readFailure:false,linkFailure:false,linkCount:null,activeReads:0,peakReads:0};`;
const modules: Record<string,string> = {
  'next/cache': 'export function revalidatePath(){}',
  'next/navigation': 'export function redirect(url){throw new Error("REDIRECT:"+url);}',
  './access.ts': `export async function requireAccess(){return {session:{role:'field',name:'Crew'},projectIds:['p1'],can:()=>true};}`,
  './permissions': 'export function assertCan(){} export function ownsTask(){} export const GRANTABLE_RESOURCES=[];',
  './scope': 'export async function actionTenantScope(){return {contractorId:"tenant1"};} export function requireTenantScope(){}',
  './data/current-source.ts': 'export async function currentDataSource(){return {getProject:async()=>({projectName:"Pilot"})};}',
  './data/current-writer.ts': `export function currentWriter(){return {createUpdate:async()=>{state.events.push('create');return 'update1';}};}`,
  './hub-db/media.ts': `export function getHubMedia(){return state.mediaAvailable?{available:true,media:{
    getById:async(scope,kind,id)=>{state.events.push('check');state.activeReads++;state.peakReads=Math.max(state.peakReads,state.activeReads);await Promise.resolve();state.activeReads--;if(state.readFailure)throw Object.assign(new Error('isolated read failure'),{stack:'Error: isolated read failure'});return state.photos.find(photo=>photo.id===id)??null;},
    linkToUpdate:async(scope,kind,ids,updateId,projectId)=>{state.events.push('link');state.links.push({ids,updateId,projectId});if(state.linkFailure)throw Object.assign(new Error('isolated link failure'),{stack:'Error: isolated link failure'});return state.linkCount??ids.length;}
  }}:{available:false};}`,
  './notify/pm.ts': `export async function notifyPmOfFieldSubmission(scope,input){state.events.push('notify');state.notifications.push(input);return {sent:true};}`,
  './project-codes.ts': 'export function contractorCode(){return null;} export function clientCode(){return null;}',
  './workflows/executor': 'export async function execute(){} export function describe(){return "fixture";}',
};

interface State {
  photos:{id:string;projectId:string;updateId:string|null}[];
  events:string[]; links:{ids:string[];updateId:string;projectId:string}[];
  notifications:{photoCount:number}[]; mediaAvailable:boolean;readFailure:boolean;linkFailure:boolean;linkCount:number|null;
  activeReads:number;peakReads:number;
}

async function harness(): Promise<{state:State;submitFieldUpdate:(data:FormData)=>Promise<void>}> {
  const root=dirname(fileURLToPath(import.meta.url));
  const output=await build({stdin:{contents:"export {submitFieldUpdate} from './actions.ts';export {state} from 'daily-fixture-state';",resolveDir:root},
    absWorkingDir:resolve(root,'../..'),bundle:true,write:false,platform:'node',format:'esm',packages:'external',
    plugins:[{name:'isolated-daily-action',setup(build){
      build.onResolve({filter:/^daily-fixture-state$/},()=>({path:'state',namespace:'daily-fixture'}));
      build.onResolve({filter:/.*/},args=>args.importer.endsWith('/lib/actions.ts')&&modules[args.path]!==undefined?{path:args.path,namespace:'daily-fixture'}:undefined);
      build.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'daily-fixture'}));
      build.onResolve({filter:/^[^./]/},args=>
        args.path.startsWith('node:') || args.path.startsWith('@/') || args.path==='@buildsuite/contracts'
          ? undefined : {path:pathToFileURL(require.resolve(args.path)).href,external:true});
      build.onLoad({filter:/.*/,namespace:'daily-fixture'},args=>({contents:args.path==='state'?stateModule:args.path==='empty'?'':`import {state} from 'daily-fixture-state';\n${modules[args.path]}`,loader:'js'}));
    }}],
  });
  const action=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.contents).toString('base64')}#${crypto.randomUUID()}`);
  return {state:action.state,submitFieldUpdate:async data=>{
    try { await action.submitFieldUpdate(data); }
    catch(error) {
      if(error instanceof Error) error.stack=`${error.name}: ${error.message} (isolated daily action fixture)`;
      throw error;
    }
  }};
}

function form(ids=['photo1']) {
  const data=new FormData();data.set('projectId','p1');data.set('workCompleted','Software test');
  ids.forEach(id=>data.append('photoId',id));return data;
}

test('daily update checks and deduplicates photo references before creating the update',async()=>{
  const action=await harness();
  await assert.rejects(action.submitFieldUpdate(form(['photo1','photo1'])),/REDIRECT:.*submitted=1/);
  assert.deepEqual(action.state.events,['check','create','link','notify']);
  assert.deepEqual(action.state.links[0]?.ids,['photo1']);
  assert.equal(action.state.notifications[0]?.photoCount,1);
});

test('stale, missing and wrong-project daily photo references cause no writes',async()=>{
  for(const photo of [null,{id:'photo1',projectId:'other',updateId:null},{id:'photo1',projectId:'p1',updateId:'old-update'}]) {
    const action=await harness();action.state.photos=photo===null?[]:[photo];
    await assert.rejects(action.submitFieldUpdate(form()),/not available/);
    assert.deepEqual(action.state.events,['check']);assert.equal(action.state.links.length,0);
  }
});

test('unavailable or failed daily photo verification does not save an update',async()=>{
  for(const mode of ['unavailable','failure']) {
    const action=await harness();action.state.mediaAvailable=mode!=='unavailable';action.state.readFailure=mode==='failure';
    await assert.rejects(action.submitFieldUpdate(form()),/cannot be checked|could not be checked/);
    assert.equal(action.state.events.includes('create'),false);assert.equal(action.state.notifications.length,0);
  }
});

test('daily photo link failure preserves the update, reports partial filing and does not inflate email counts',async()=>{
  for(const mode of ['throw','partial']) {
    const action=await harness();action.state.linkFailure=mode==='throw';action.state.linkCount=mode==='partial'?0:null;
    await assert.rejects(action.submitFieldUpdate(form()),/REDIRECT:.*photos=partial/);
    assert.equal(action.state.events.filter(event=>event==='create').length,1);
    assert.equal(action.state.notifications[0]?.photoCount,0);
  }
});

test('a daily update without photos does not depend on media availability',async()=>{
  const action=await harness();action.state.mediaAvailable=false;
  await assert.rejects(action.submitFieldUpdate(form([])),/REDIRECT:.*submitted=1/);
  assert.deepEqual(action.state.events,['create','notify']);assert.equal(action.state.notifications[0]?.photoCount,0);
});

test('many restored references are checked completely with bounded read concurrency',async()=>{
  const action=await harness();
  action.state.photos=Array.from({length:17},(_,index)=>({id:`photo${index}`,projectId:'p1',updateId:null}));
  await assert.rejects(action.submitFieldUpdate(form(action.state.photos.map(photo=>photo.id))),/REDIRECT:.*submitted=1/);
  assert.equal(action.state.peakReads,8);
  assert.deepEqual(action.state.events,[...Array(17).fill('check'),'create','link','notify']);
  assert.equal(action.state.links[0]?.ids.length,17);
});

test('an unassigned project is refused before checking photos or making any write',async()=>{
  const action=await harness();const data=form();data.set('projectId','other');
  await assert.rejects(action.submitFieldUpdate(data),/project not assigned/);
  assert.deepEqual(action.state.events,[]);
});
