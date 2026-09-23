import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInvoiceFinancials, loadPaymentHistory, historyNotes } from './payment-history.ts';
import { invoiceStatement } from './statement.ts';
import { buildGhlInvoicePayload } from './ghl-rail.ts';
import { composeFirstInvoice } from './invoice.ts';
import { GhlInvoices } from '../ghl/invoices.ts';

const expected={id:'one',locationId:'APS',contactId:'client'};
const row=(over:Record<string,unknown>={})=>({_id:'one',altId:'APS',altType:'location',contactDetails:{id:'client',name:'Test'},invoiceNumber:'INV-1',status:'paid',currency:'USD',total:110,amountPaid:110,amountDue:0,totalSummary:{subTotal:100,tax:10,discount:0},invoiceItems:[{name:'Deposit',amount:100,qty:1}],...over});
const read=(over:Record<string,unknown>={})=>readInvoiceFinancials(row(over),expected);
const link=(over={})=>({id:'draft1',projectId:'project1',externalId:'one',sentVia:'ghl',...over});

test('complete financial summary retains tax, subtotal and exact cents',()=>{
 const result=read({total:1212.5,amountPaid:100.01,amountDue:1112.49});
 assert.equal(result.total,1212.5);assert.equal(result.paid,100.01);assert.equal(result.tax,10);
});
test('missing tax remains unknown rather than zero',()=>assert.equal(read({totalSummary:{}}).tax,null));
test('reject missing payment, invalid money and mismatched tenant/contact/id',()=>{
 for(const patch of [{amountPaid:undefined},{amountPaid:-1},{amountPaid:NaN},{total:Infinity},{currency:'CAD'},{altId:'AFC'},{_id:'another'},{contactDetails:{id:'other'}},{status:'refunded'}]) assert.throws(()=>read(patch));
});
test('wrapped API response retains identity validation',()=>assert.equal(readInvoiceFinancials({invoice:row()},expected).paid,110));
test('history joins by linked IDs, not by contact; removes duplicates and current invoice',async()=>{
 const calls:string[]=[];
 const history=await loadPaymentHistory([link(),link({id:'duplicate'}),link({id:'current',externalId:'two'}),link({id:'foreign',projectId:'other',externalId:'foreign'}),link({id:'unsaved',externalId:null})],'current','project1',async id=>{calls.push(id);return read()});
 assert.deepEqual(calls,['one']);assert.equal(history.paid,110);
});
test('draft and void invoices do not count as payments',async()=>{
 for(const status of ['draft','void']){
 const history=await loadPaymentHistory([link()],'current','project1',async()=>read({status}));
 assert.equal(history.paid,0);assert.equal(history.entries.length,0);
 }
});
test('processing payments, unknown source, unresolved creates and read failures block history',async()=>{
 await assert.rejects(loadPaymentHistory([link()],'current','project1',async()=>read({status:'payment_processing'})));
 await assert.rejects(loadPaymentHistory([link({sentVia:'stripe'})],'current','project1',async()=>read()));
 await assert.rejects(loadPaymentHistory([link({externalId:null,creationAttemptId:'attempt'})],'current','project1',async()=>read()));
 await assert.rejects(loadPaymentHistory([link()],'current','project1',async()=>{throw Error('403')}));
 await assert.rejects(loadPaymentHistory(Array.from({length:200},()=>link()),'current','project1',async()=>read()));
});
test('partial payments count by cents, not invoice face value',async()=>{
 const history=await loadPaymentHistory([link()],'current','project1',async()=>read({status:'partially_paid',amountPaid:10.01,amountDue:99.99}));
 assert.equal(history.paid,10.01);
});
test('new invoice history does not subtract earlier installment receipts or record a payment',async()=>{
 const history=await loadPaymentHistory([link()],'current','project1',async()=>read());
 const invoice=composeFirstInvoice([{order:2,title:'Stage two',description:'Agreed terms <script>',amount:1212.5,percent:25,raw:'stage'}],{projectCode:'P-1',clientName:'Test'})!;
 const payload=buildGhlInvoicePayload({...invoice,paymentHistory:history},{ghlContactId:'client',name:'Test',email:'test@example.com'},{locationId:'APS',issue:new Date('2026-09-23'),dueInDays:5});
 assert.equal(payload.items[0].amount,1212.5);
 assert.equal('amountPaid' in payload,false);
 assert.match(payload.termsNotes,/\$110.00/);
 assert.match(payload.termsNotes,/not deducted again/);
 assert.match(payload.termsNotes,/&lt;script&gt;/);
});
test('statement shows all requested totals and escapes untrusted content',()=>{
 const invoice=read({businessDetails:{name:'<script>alert(1)</script>',logoUrl:'javascript:alert(1)'},termsNotes:'<script>alert(1)</script>'});
 const history={checkedAt:'2026-09-23',paid:110,entries:[invoice]};
 const html=invoiceStatement(invoice,history,'P-1');
 for(const label of ['Subtotal','Tax','Invoice total','Paid on this invoice','Amount due on this invoice','Other project invoices'])assert.ok(html.includes(label));
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('src="javascript:'));assert.ok(html.includes('sandbox'));
 assert.ok(historyNotes(history).includes('snapshot'));
});
test('financial read includes location and disables cache; rejects foreign account',async()=>{
 const config={baseUrl:'https://example.test',apiVersion:'2021-07-28',token:'test',locationId:'APS',projectObjectKey:''};
 const reader=new GhlInvoices(config,async(url,init)=>{
 assert.equal(String(url),'https://example.test/invoices/one?altId=APS&altType=location');assert.equal(init?.cache,'no-store');
 return new Response(JSON.stringify(row()));
 });
 assert.equal((await reader.financials('one','client')).paid,110);
 const bad=new GhlInvoices(config,async()=>new Response(JSON.stringify(row({altId:'AFC'}))));
 await assert.rejects(bad.financials('one','client'));
});
