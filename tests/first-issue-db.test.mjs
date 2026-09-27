import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const user='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000002',job='20000000-0000-0000-0000-000000000001';
const migration=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const ready=(async()=>{
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema cron; create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
    create table digest_jobs(id uuid primary key,user_id uuid,reason text check(reason in ('manual','scheduled','test','one_time')),status text check(status in ('queued','running','sent','partial','failed','empty')),idempotency_key text unique,run_after timestamptz,error text,created_at timestamptz default now(),finished_at timestamptz,result jsonb default '{}');
    create table delivery_outbox(job_id uuid primary key references digest_jobs(id),payload jsonb,first_send_at timestamptz,provider_email_id text);`);
  await db.exec(migration('20260927121256_first_issue_preview.sql'));
  await db.exec(migration('20260927123611_deduplicate_first_issue_preparation.sql'));
})();
async function isolated(work){await ready;await db.exec('begin');try{
  await db.query(`insert into digest_jobs(id,user_id,reason,status,idempotency_key) values($1,$2,'first_run_preview','ready','preview')`,[job,user]);
  await db.query(`insert into delivery_outbox(job_id,payload) values($1,$2::jsonb)`,[job,JSON.stringify({email:{to:[],attachments:[{filename:'frozen.epub',content:'frozen-bytes'}]}})]);
  await work();
}finally{await db.exec('rollback')}}
const queue=(u=user)=>db.query('select queue_first_issue($1,$2,$3,$4)',[u,job,'reader@kindle.com','daily-issue:test']);
test.after(async()=>{await ready;await db.close()});
test('reviewed issue queues atomically, preserves attachment bytes, and repeats are idempotent',()=>isolated(async()=>{
  await queue();await queue();
  const [r]=(await db.query('select j.reason,j.status,o.payload from digest_jobs j join delivery_outbox o on j.id=o.job_id')).rows;
  assert.equal(r.reason,'manual');assert.equal(r.status,'queued');assert.deepEqual(r.payload.email.to,['reader@kindle.com']);assert.equal(r.payload.email.attachments[0].content,'frozen-bytes');
}));
test('a different user cannot queue another reader’s prepared issue',()=>isolated(async()=>{await assert.rejects(queue(other),/not found/)}));
test('a preparation without its frozen payload cannot be sent',()=>isolated(async()=>{await db.query('update delivery_outbox set payload=null');await assert.rejects(queue(),/expired/)}));
test('an older preview cannot be sent while a newer one is preparing',()=>isolated(async()=>{
  await db.query(`insert into digest_jobs(id,user_id,reason,status,idempotency_key,created_at) values('20000000-0000-0000-0000-000000000002',$1,'first_run_preview','queued','newer',now()+interval '1 second')`,[user]);
  await assert.rejects(queue(),/newer first issue/);
}));
test('concurrent prepare attempts cannot create multiple active previews',()=>isolated(async()=>{
  await db.query("update digest_jobs set status='queued'");
  await assert.rejects(db.query(`insert into digest_jobs(id,user_id,reason,status,idempotency_key) values('20000000-0000-0000-0000-000000000002',$1,'first_run_preview','queued','duplicate')`,[user]),/duplicate key/);
}));
test('queue transition is restricted to the backend',async()=>{
  await ready;const [r]=(await db.query("select has_function_privilege('anon','queue_first_issue(uuid,uuid,text,text)','execute') as anon,has_function_privilege('authenticated','queue_first_issue(uuid,uuid,text,text)','execute') as auth,has_function_privilege('service_role','queue_first_issue(uuid,uuid,text,text)','execute') as backend")).rows;
  assert.equal(r.anon,false);assert.equal(r.auth,false);assert.equal(r.backend,true);
});
