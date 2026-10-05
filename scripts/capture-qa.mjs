/** Read-only API snapshot for the developer replay. Never commits credentials or data. */
import fs from 'node:fs/promises';
const file=process.env.LF_QA_TOKEN_FILE;
if(!file)throw Error('Set LF_QA_TOKEN_FILE to a private, short-lived account session.');
const token=(await fs.readFile(file,'utf8')).trim();
const base=process.env.LF_QA_API||'https://wuikfmmwvrzpaoevtskn.supabase.co/functions/v1/app-api';
async function read(path,body){
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  const data=await response.json();if(!response.ok)throw Error(`${path}: ${response.status} ${data.error}`);return data;
}
const snapshot={version:1,captured_at:new Date().toISOString(),responses:{},articles:{}};
const me=await read('/me');
if(!/@resend\.dev$/.test(me.user.email)||!me.settings.paused)throw Error('Only a paused Resend validation account may be captured.');
snapshot.responses['/me']={...me,jobs:me.jobs.map(({result,...job})=>({...job,result:result?{issues:result.issues}:null}))};
for(const path of ['/publication/editions','/reader/library','/editor/history','/delivery-history','/system','/publication/feed'])snapshot.responses[path]=await read(path);
for(const edition of snapshot.responses['/publication/editions'].editions.slice(0,Number(process.env.LF_QA_EDITIONS||1))){
  for(let position=0;position<edition.items.length;position++)snapshot.articles[`${edition.id}:${position}`]=await read('/reader/article',{edition_id:edition.id,position});
}
const out=process.env.LF_QA_OUT||'test-results/account-snapshot.json';
await fs.mkdir('test-results',{recursive:true});await fs.writeFile(out+'.tmp',JSON.stringify(snapshot),{mode:0o600});JSON.parse(await fs.readFile(out+'.tmp','utf8'));await fs.rename(out+'.tmp',out);
console.log(`Captured ${snapshot.responses['/publication/editions'].editions.length} editions and ${Object.keys(snapshot.articles).length} originals. No account changes or sends.`);
