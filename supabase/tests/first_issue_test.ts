import {firstIssueInputKey,firstIssueInterrupted} from "../functions/_shared/first-issue.ts";
function assert(value:unknown,message:string){if(!value)throw new Error(message)}
Deno.test("interrupted preview detection preserves active work and never changes real sends",()=>{
  const now=Date.now(),job={reason:"first_run_preview",status:"running",started_at:new Date(now-600_001).toISOString()};
  assert(firstIssueInterrupted(job,now),"An expired worker claim must offer recovery");
  assert(!firstIssueInterrupted({...job,started_at:new Date(now-400_000).toISOString()},now),"A live invocation must not be duplicated");
  assert(!firstIssueInterrupted({...job,reason:"manual"},now),"Real sends need separate reconciliation");
  assert(!firstIssueInterrupted({...job,status:"ready"},now),"Ready issues must remain reviewable");
});
Deno.test("preview remains valid after fetch health updates and Kindle save, but reader edits invalidate it",async()=>{
  const feeds=[{id:"f1",name:"Example",url:"https://example.com/feed",enabled:true,updated_at:"before"}];
  const settings={editorial_brief:"Science",editorial_instructions:"",kindle_email:null,paused:false};
  const original=await firstIssueInputKey(feeds,settings);
  assert(original===await firstIssueInputKey([{...feeds[0],updated_at:"after",last_fetch_at:"after",last_error:null}],{...settings,kindle_email:"reader@kindle.com",paused:true}),"Worker health updates and Kindle settings must preserve the preview");
  assert(original!==await firstIssueInputKey([{...feeds[0],url:"https://example.org/feed"}],settings),"Changing a source must invalidate the issue");
  assert(original!==await firstIssueInputKey(feeds,{...settings,editorial_brief:"History"}),"Changing guidance must invalidate the issue");
  assert(original!==await firstIssueInputKey(feeds,settings,[{id:"a1",url:"https://example.com/article",section_name:"Saved"}]),"Adding an article must invalidate the issue");
});
