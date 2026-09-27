// Only reader-controlled inputs invalidate an issue. Fetch health timestamps
// change during preparation and must never invalidate the result it produces.
export async function firstIssueInputKey(feeds:any[],settings:any,pending:any[]=[]){
  const input={
    feeds:feeds.map(f=>({id:f.id,name:f.name,url:f.url,enabled:f.enabled,archived_at:f.archived_at||null})).sort((a,b)=>String(a.id).localeCompare(String(b.id))),
    editorial_brief:settings.editorial_brief||"",
    editorial_instructions:settings.editorial_instructions||"",
    pending:pending.map(p=>({id:p.id,url:p.url,section_name:p.section_name})).sort((a,b)=>String(a.id).localeCompare(String(b.id))),
  };
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(input))));
  return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
