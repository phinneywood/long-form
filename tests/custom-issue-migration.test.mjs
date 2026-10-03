import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
test("custom issue queue is atomic, tenant restricted, collision safe, and preserves original URL jobs",async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table public.app_users(id uuid primary key);
 create table public.user_settings(user_id uuid primary key,kindle_email text);
 create table public.digest_jobs(id uuid primary key default gen_random_uuid(),user_id uuid,reason text,status text,lookback_hours integer,idempotency_key text unique,run_after timestamptz,packet_name text,article_urls jsonb not null default '[]',constraint digest_jobs_one_time_payload_check check(true));
 create function public.kick_digest_worker() returns bigint language sql as 'select 1::bigint';
 insert into app_users values('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
 insert into user_settings values('10000000-0000-0000-0000-000000000001','test@example.com');`);
 await db.exec(await readFile("supabase/migrations/20261003161539_custom_kindle_issue.sql","utf8"));
 const uid="10000000-0000-0000-0000-000000000001",key=`custom-issue:${uid}:sample`,issue={title:"Custom",sections:[{title:"One",content:"Full text",format:"text"}],source_links:[]};
 const queue=payload=>db.query("select * from public.queue_custom_issue($1,$2::jsonb,$3)",[uid,JSON.stringify(payload),key]);
 const first=(await queue(issue)).rows[0],second=(await queue(issue)).rows[0];
 assert.equal(first.created,true);assert.equal(second.created,false);assert.equal(first.job_id,second.job_id);
 await assert.rejects(queue({...issue,title:"Changed"}),/different issue/);
 await assert.rejects(db.query("select * from queue_custom_issue($1,$2::jsonb,$3)",["10000000-0000-0000-0000-000000000002",JSON.stringify(issue),key]),/not configured/);
 const grants=await db.query("select has_function_privilege('anon','queue_custom_issue(uuid,jsonb,text)','execute') as anon,has_function_privilege('authenticated','queue_custom_issue(uuid,jsonb,text)','execute') as authenticated,has_function_privilege('service_role','queue_custom_issue(uuid,jsonb,text)','execute') as service");assert.deepEqual(grants.rows[0],{anon:false,authenticated:false,service:true});
 await db.exec(`insert into digest_jobs(user_id,reason,status,packet_name,article_urls)values('${uid}','one_time','queued','Originals','["https://example.com/original"]');`);
 await assert.rejects(db.exec(`insert into digest_jobs(reason,status,packet_name)values('one_time','queued','Empty');`),/constraint/);
 await assert.rejects(db.exec(`insert into digest_jobs(reason,status,custom_issue)values('scheduled','queued','{}');`),/constraint/);
 assert.equal((await db.query("select count(*)::int as n from digest_jobs")).rows[0].n,2);
 }finally{await db.close();}
});
