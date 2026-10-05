import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const stateModule = `export const state = {
  proposalFailure:false, teamFailure:false, projectFailure:false, taskFailure:false,
  hubAvailable:true, missingProject:false, financials:false,
  calls:[], members:[], proposals:[]
};`;
const modules: Record<string, string> = {
  'next/link': 'export default function Link(){}',
  'next/navigation': "export function notFound(){throw Error('NOT_FOUND');}",
  '@/lib/scope': "export async function requireTenantScope(){return {contractorId:'tenant1',locationId:'location1',authProfileIds:['profile1']};}",
  '@/lib/data/types': 'export function hasFinancials(){return state.financials;} export function hasOperationalDetail(){return false;} export function stageLabel(){return "Active";}',
  '@/lib/data/current-source': `export async function currentDataSource(){return {
    getProject:async(scope,id)=>{state.calls.push({kind:'project',scope,id});if(state.projectFailure)throw Error('PROJECT_READ');return state.missingProject ? null : {buildsuiteProjectId:id,projectName:'Pilot',clientName:'Test client',projectAddress:'Test address',currentMilestone:'',nextMilestone:'',budgetBand:'$10k-$20k'};},
    listMilestones:async()=>[],listDailyUpdates:async()=>[],
    listTasks:async()=>{if(state.taskFailure)throw Error('TASK_READ');return [];}
  };}`,
  '@/components/ui': `export function Badge(){} export function Card(){} export function CardHeader(){} export function InternalNote(){} export function InternalOnly(){} export function ProgressBar(){} export function currency(value){return String(value);} export function shortDate(value){return String(value);}`,
  '@/components/project-editor': 'export function ProjectEditor(){}',
  '@/lib/hub-db/records': 'export function getHubRecords(){return {available:false};}',
  '@/lib/hub-db/team': `export function getHubTeam(){return state.hubAvailable ? {available:true,team:{listTeam:async(scope)=>{state.calls.push({kind:'team',scope});if(state.teamFailure)throw Error('TEAM_READ');return state.members;}}} : {available:false};}`,
  '@/lib/buildsuite/proposals': `export function pickCurrentProposal(rows){return rows[0] ?? null;} export function getProposalsReader(){return {available:true,listForProjects:async(scope,ids)=>{state.calls.push({kind:'proposal',scope,ids});if(state.proposalFailure)throw Error('PROPOSAL_READ');return state.proposals;}};}`,
};

interface State {
  proposalFailure: boolean; teamFailure: boolean; projectFailure: boolean; taskFailure: boolean;
  hubAvailable: boolean; missingProject: boolean; financials: boolean;
  calls: { kind: string; scope: { contractorId: string }; id?: string; ids?: string[] }[];
  members: { id: string; fullName: string; email: string; role: string; revoked: boolean; activated: boolean; projectIds: string[] }[];
  proposals: { amount: number; signed: boolean }[];
}

async function harness(): Promise<{
  state: State;
  page: (props: {params: Promise<{id: string}>}) => Promise<unknown>;
}> {
  const root = dirname(fileURLToPath(import.meta.url));
  const output = await build({
    stdin: {contents: "export {default as page} from '../app/dashboard/projects/[id]/page.tsx'; export {state} from 'overview-fixture';", resolveDir:root},
    bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',packages:'external',
    plugins:[{name:'isolated-overview',setup(build){
      build.onResolve({filter:/^react\/jsx-runtime$/},()=>({path:pathToFileURL(require.resolve('react/jsx-runtime')).href,external:true}));
      build.onResolve({filter:/^overview-fixture$/},()=>({path:'state',namespace:'overview'}));
      build.onResolve({filter:/.*/},(args)=> modules[args.path] === undefined ? undefined : {path:args.path,namespace:'overview'});
      build.onLoad({filter:/.*/,namespace:'overview'},(args)=>({contents:args.path==='state' ? stateModule : `import {state} from 'overview-fixture';\n${modules[args.path]}`,loader:'js'}));
    }}],
    absWorkingDir:resolve(root,'../..'),
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.contents).toString('base64')}#${crypto.randomUUID()}`);
}

// Inspect the actual page's selected JSX children, not unrendered component props.
function text(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (tree !== null && typeof tree === 'object' && 'props' in tree) {
    return text((tree as {props:{children?:unknown}}).props.children);
  }
  return '';
}
const props = () => ({params:Promise.resolve({id:'p1'})});

test('optional proposal outage reports unavailable, not a budget estimate or a page crash', async()=>{
  const app=await harness();app.state.proposalFailure=true;
  const content=text(await app.page(props()));
  assert.match(content,/Contract details could not be loaded/);
  assert.doesNotMatch(content,/No budget recorded|BuildSuite records a budget band|\$10k-\$20k/);
  assert.match(content,/No updates yet/);
});

test('failed or unconfigured team lookup never claims nobody has project access', async()=>{
  for (const mode of ['failure','unconfigured']) {
    const app=await harness();app.state.teamFailure=mode==='failure';app.state.hubAvailable=mode!=='unconfigured';
    const content=text(await app.page(props()));
    assert.match(content,/Project access could not be loaded/);
    assert.doesNotMatch(content,/Nobody has been invited/);
  }
});

test('confirmed empty team and proposal results keep the real empty state', async()=>{
  const app=await harness();const content=text(await app.page(props()));
  assert.match(content,/Nobody has been invited/);
  assert.match(content,/\$10k-\$20k/);
  assert.doesNotMatch(content,/could not be loaded/);
});

test('GHL financials remain usable when the optional BuildSuite proposal read fails', async()=>{
  const app=await harness();app.state.proposalFailure=true;app.state.financials=true;
  const content=text(await app.page(props()));
  assert.match(content,/Contract Amount|Current Project Total/);
  assert.doesNotMatch(content,/Contract details could not be loaded|\$10k-\$20k/);
});

test('normal overview filters members and scopes every optional lookup after project ownership', async()=>{
  const app=await harness();app.state.proposals=[{amount:50000,signed:true}];
  app.state.members=[
    {id:'m1',fullName:'Assigned crew',email:'crew@example.test',role:'field',revoked:false,activated:true,projectIds:['p1']},
    {id:'m2',fullName:'Other project',email:'other@example.test',role:'field',revoked:false,activated:true,projectIds:['p2']},
    {id:'m3',fullName:'Revoked crew',email:'revoked@example.test',role:'field',revoked:true,activated:true,projectIds:['p1']},
  ];
  const content=text(await app.page(props()));
  assert.match(content,/Assigned crew/);assert.doesNotMatch(content,/Other project|Revoked crew/);
  assert.match(content,/50000/);
  assert.deepEqual(app.state.calls.map(call=>call.kind),['project','proposal','team']);
  assert.ok(app.state.calls.every(call=>call.scope.contractorId==='tenant1'));
  assert.deepEqual(app.state.calls[1]?.ids,['p1']);
});

test('mandatory ownership/project and operational errors still fail closed', async()=>{
  for (const mode of ['missingProject','projectFailure','taskFailure'] as const) {
    const app=await harness();app.state[mode]=true;
    await assert.rejects(()=>app.page(props()),/NOT_FOUND|PROJECT_READ|TASK_READ/);
    if(mode!=='taskFailure')assert.deepEqual(app.state.calls.map(call=>call.kind),['project']);
  }
});
