import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { HubInvoiceDrafts } from '../hub-db/invoice-drafts.ts';
import { createGhlInvoiceRail } from './ghl-rail.ts';
import { draftFromStored } from './rail.ts';
import { loadPaymentHistory } from './payment-history.ts';

// Run the actual server action without Next's request context or live services.
const source = readFileSync(new URL('../actions.ts', import.meta.url), 'utf8');
const body = source.split('export async function createInvoiceOnRail(formData: FormData) {')[1]!
  .split('// \u2500\u2500 Schedule')[0]!.trim().replace(/}\s*$/, '')
  .replace('let template: InvoiceTemplate | null = null', 'let template = null')
  .replace('(err as Error).message', 'err.message');
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const names = ['getSession','assertCan','actionTenantScope','getHubInvoiceDrafts','currentDataSource',
  'resolveContractorProfile','getHubInvoiceTemplates','resolveInvoiceRail','mergeLetterhead','dueDaysFor',
  'getBuildSuiteReader','draftFromStored','redirect','revalidatePath','process','randomUUID','getInvoices','loadPaymentHistory','formData'];
const action = new AsyncFunction(...names, body);

function fixture(mode = 'ok') {
  const row: Record<string, unknown> = {id:'draft-test', contractor_id:'contractor-test',
    project_id:'project-test', proposal_id:'proposal-test', line_order:1, amount:1455,
    title:'Test deposit', description:'Test only', status:'ready', external_id:null, creation_attempt_id:null};
  let calls = 0;
  const client = {
    async select() { return [{...row}]; },
    async update({filters, patch}: {filters: Record<string,string>; patch: Record<string,unknown>}) {
      assert.equal(filters.contractor_id, 'eq.contractor-test');
      assert.equal(filters.id, 'eq.draft-test');
      if ('creation_started_at' in patch && mode === 'missing-schema') throw Error('missing column');
      if ('external_id' in patch && mode === 'lost-record') throw Error('database outage');
      if (filters.external_id === 'is.null' && row.external_id !== null) return [];
      if (filters.creation_attempt_id === 'is.null' && row.creation_attempt_id !== null) return [];
      if (filters.creation_attempt_id?.startsWith('eq.') && filters.creation_attempt_id !== `eq.${row.creation_attempt_id}`) return [];
      if (filters.status && !['draft','ready'].includes(String(row.status))) return [];
      if (filters.amount === 'not.is.null' && row.amount === null) return [];
      Object.assign(row, patch);
      if ('creation_started_at' in patch && mode === 'lost-claim-response') throw Error('response lost');
      return [{...row}];
    },
  };
  const drafts = new HubInvoiceDrafts(client as never);
  const rail = createGhlInvoiceRail({token:'fake',locationId:'test',fetchImpl:async(url,options)=>{
    assert.equal(url,'https://services.leadconnectorhq.com/invoices/');
    assert.equal(options?.method,'POST');
    const id = `fake-${++calls}`;
    if (mode === 'network') throw Error('connection lost after external creation');
    if (mode === 'reject') return new Response('{}',{status:400});
    return new Response(JSON.stringify({id}));
  }});
  const scope = {contractorId:'contractor-test',locationId:'test',authProfileIds:['test']};
  const deps = [async()=>({role:'contractor',name:'Test'}),()=>{},async()=>scope,
    ()=>({available:true,drafts}),async()=>({getProject:async()=>({projectCode:'DEMO',clientName:'Test',primaryContactId:'test-contact'})}),
    async()=>null,()=>({available:false}),()=>rail,()=>undefined,()=>5,
    ()=>({available:true,clientEmailForProject:async()=> 'test@example.com'}),draftFromStored,
    (url:string)=>{throw Error('redirect '+url);},()=>{},{env:{}},randomUUID,
    async()=>({available:mode !== 'history-unavailable',invoices:{financials:async()=>{throw Error('No earlier invoices expected');}}}),loadPaymentHistory,
    new Map([['draftId','draft-test'],['proposalId','proposal-test']])];
  return {run:()=>action(...deps), row, calls:()=>calls, drafts, scope};
}

test('20 concurrent attempts produce only one external invoice',async()=>{
  const f=fixture();
  const results=await Promise.allSettled(Array.from({length:20},()=>f.run()));
  assert.equal(f.calls(),1);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.row.external_id,'fake-1');
  await assert.rejects(f.run());
  assert.equal(f.calls(),1);
});
for (const mode of ['lost-record','network','reject']) {
  test(`${mode}: retry remains blocked without a second GHL call`,async()=>{
    const f=fixture(mode);
    await assert.rejects(f.run());
    assert.ok(f.row.creation_attempt_id);
    await assert.rejects(f.run());
    assert.equal(f.calls(),1);
  });
}
for (const mode of ['missing-schema','lost-claim-response','history-unavailable']) {
  test(`${mode}: never calls GHL`,async()=>{
    const f=fixture(mode);
    await assert.rejects(f.run());
    await assert.rejects(f.run());
    assert.equal(f.calls(),0);
  });
}
test('claimed draft cannot be edited or completed by another attempt',async()=>{
  const f=fixture();
  await f.drafts.claimRailCreation(f.scope,'draft-test',randomUUID());
  await f.drafts.save(f.scope,'draft-test',{amount:1},{name:'Test'});
  assert.equal(f.row.amount,1455);
  await assert.rejects(f.drafts.recordRailCreation(f.scope,'draft-test',{name:'ghl',externalId:'wrong'},{name:'Test'},randomUUID()));
  assert.equal(f.row.external_id,null);
});
test('void and missing-amount drafts cannot acquire a claim',async()=>{
  const f=fixture();
  f.row.status='void';
  assert.equal(await f.drafts.claimRailCreation(f.scope,'draft-test',randomUUID()),null);
  f.row.status='ready'; f.row.amount=null;
  assert.equal(await f.drafts.claimRailCreation(f.scope,'draft-test',randomUUID()),null);
});
