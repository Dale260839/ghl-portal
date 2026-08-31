import fs from 'node:fs';
const env=fs.readFileSync('.env.local','utf8');
const g=k=>(env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.trim();
const BASE=g('GHL_API_BASE_URL'), VER=g('GHL_API_VERSION'), TOK=g('GHL_PRIVATE_INTEGRATION_TOKEN'), LOC=g('GHL_LOCATION_ID');
const H={Authorization:`Bearer ${TOK}`,Version:VER,Accept:'application/json','Content-Type':'application/json'};
const r=await fetch(`${BASE}/objects/custom_objects.projects/records/search`,{method:'POST',headers:H,body:JSON.stringify({locationId:LOC,page:1,pageLimit:50,query:''})});
const d=JSON.parse(await r.text());
console.log('records:',d.records?.length ?? 0,'| total:',d.total ?? '?');
for(const rec of d.records??[]){
  const p=rec.properties??{};
  console.log('\n ',rec.id);
  for(const [k,v] of Object.entries(p)) if(v!==null&&v!==''&&String(v)!=='0') console.log('     ',k.padEnd(26),JSON.stringify(v).slice(0,60));
}
