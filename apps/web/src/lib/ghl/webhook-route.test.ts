import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign, createSign } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expectedSignature } from './webhook.ts';

const ed = generateKeyPairSync('ed25519', { publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'} });
const rsa = generateKeyPairSync('rsa', { modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'} });
const SECRET = 'local-test-relay-secret';

async function route(env: Record<string,string>): Promise<{POST:(request:Request)=>Promise<Response>;GET:()=>Response}> {
  const root=dirname(fileURLToPath(import.meta.url));
  const output=await build({
    stdin:{contents:"export {POST,GET} from '../../app/api/ghl/webhook/route.ts';",resolveDir:root},
    absWorkingDir:resolve(root,'../../..'),bundle:true,write:false,platform:'node',format:'esm',packages:'external',
    plugins:[{name:'isolated-webhook-route',setup(build){
      build.onResolve({filter:/^next\/server$/},()=>({path:'response',namespace:'route-fixture'}));
      build.onResolve({filter:/^@\/lib\/ghl\/webhook$/},()=>({path:'verification',namespace:'route-fixture'}));
      build.onLoad({filter:/.*/,namespace:'route-fixture'},args=>({
        contents:args.path==='response' ? 'export const NextResponse={json:(body,init)=>Response.json(body,init)};' :
          `export * from './webhook.ts'; import {readWebhookScheme as read} from './webhook.ts'; export function readWebhookScheme(unused,requested){return read(${JSON.stringify(env)},requested);}`,
        loader:'js',resolveDir:root,
      }));
    }}],
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.contents).toString('base64')}#${crypto.randomUUID()}`);
}

function request(raw: string, headers: Record<string,string>): Request {
  return new Request('http://127.0.0.1/api/ghl/webhook',{method:'POST',body:raw,headers});
}
const body=(type='ContactCreate',locationId: string|null='fixture-location')=>JSON.stringify({type,id:'fixture-resource',locationId,dateAdded:'2021-11-26T12:41:02.193Z'});
const current=(raw:string)=>sign(null,Buffer.from(raw),ed.privateKey).toString('base64');
const legacy=(raw:string)=>{const signer=createSign('RSA-SHA256');signer.update(raw);signer.end();return signer.sign(rsa.privateKey,'base64');};
const bothKeys={GHL_WEBHOOK_ED25519_PUBLIC_KEY:ed.publicKey,GHL_WEBHOOK_PUBLIC_KEY:rsa.publicKey};

test('actual route verifies Ed25519, legacy RSA and explicit relay HMAC',async()=>{
  const handler=await route({...bothKeys,GHL_WEBHOOK_SECRET:SECRET});const raw=body();
  const timestamp=String(Math.floor(Date.now()/1000));
  const cases: Record<string,string>[] = [
    {'x-ghl-signature':current(raw)},
    {'x-wh-signature':legacy(raw)},
    {'x-signature':expectedSignature(SECRET,timestamp,raw),'x-timestamp':timestamp},
  ];
  for(const headers of cases) {
    const response=await handler.POST(request(raw,headers));
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,handled:false,executed:false});
  }
});

test('a failed current signature never falls back to a valid legacy or relay signature',async()=>{
  const handler=await route({...bothKeys,GHL_WEBHOOK_SECRET:SECRET});const raw=body();const timestamp=String(Math.floor(Date.now()/1000));
  for (const signature of ['invalid', '']) {
    const response=await handler.POST(request(raw,{'x-ghl-signature':signature,'x-wh-signature':legacy(raw),'x-signature':expectedSignature(SECRET,timestamp,raw),'x-timestamp':timestamp}));
    assert.equal(response.status,401);assert.deepEqual(await response.json(),{ok:false});
  }
});

test('a current header without its configured key refuses instead of using RSA/HMAC',async()=>{
  const handler=await route({GHL_WEBHOOK_PUBLIC_KEY:rsa.publicKey,GHL_WEBHOOK_SECRET:SECRET});const raw=body();
  const response=await handler.POST(request(raw,{'x-ghl-signature':current(raw),'x-wh-signature':legacy(raw)}));
  assert.equal(response.status,503);assert.equal((await response.json()).ok,false);
});

test('recognized but unexecuted stages return failure and remain eligible for retry',async()=>{
  const handler=await route(bothKeys);const raw=body('OpportunityStageUpdate');
  for(let attempt=0;attempt<2;attempt+=1){
    const response=await handler.POST(request(raw,{'x-ghl-signature':current(raw)}));
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{ok:false,handled:false,executed:false,workflow:'WF2',error:'workflow_execution_unavailable'});
  }
});

test('known events without tenant location are not acknowledged as ignored success',async()=>{
  const handler=await route(bothKeys);const raw=body('OpportunityStageUpdate',null);
  const response=await handler.POST(request(raw,{'x-ghl-signature':current(raw)}));
  assert.equal(response.status,422);assert.equal((await response.json()).ok,false);
});

test('unsigned and malformed requests fail before workflow routing',async()=>{
  const handler=await route(bothKeys);
  assert.equal((await handler.POST(request(body(),{}))).status,401);
  assert.equal((await handler.POST(request('{',{'x-ghl-signature':current('{')}))).status,401);
  const unavailable=await route({});
  assert.equal((await unavailable.POST(request(body(),{}))).status,503);
  assert.deepEqual(await handler.GET().json(),{ok:true,endpoint:'ghl-webhook'});
});
