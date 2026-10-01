/* Publication UI uses only authenticated application capabilities. */
let editions=[],publicationEpoch=0,currentReading=null,readerFrame=null,readingSaveTimer=null,editorBusy=false,readerParagraphs=[];
let editionRequest=null,nightRequest=null;
const localReadingKey=k=>`longFormReading:${state?.user?.id}:${k}`;
const currentRoute=()=>location.hash.slice(1)||'today';
const readingContextKey=()=>`longFormReadingContext:${state?.user?.id}`;
function rememberReading(){if(currentReading)sessionStorage.setItem(readingContextKey(),JSON.stringify(currentReading));}
const readerHref=r=>r.edition_id?`#read/${r.edition_id}/${r.position}${r.reader_path==='featured'?'/featured':''}`:`#raw/${r.article_id}`;
function publicationNav(active){return `<nav class="publication-nav" aria-label="Publication"><a href="#today" ${active==='today'?'aria-current="page"':''}>Today</a><a href="#explore" ${active==='explore'?'aria-current="page"':''}>Explore</a><a href="#editor" ${active==='editor'?'aria-current="page"':''}>Editor</a><a href="#library" ${active==='library'?'aria-current="page"':''}>Library</a></nav>`;}
function publicationShell(content,active='today'){
  app.innerHTML=shell(publicationNav(active)+`<div class="publication-page">${content}</div>`,'<button class="btn account-menu-btn" id="account-menu" aria-label="Account menu">Account</button>');
  document.querySelector('#account-menu').onclick=accountMenuModal;
}
function dashboard(){if(!state?.settings?.onboarding_complete)return legacyDashboard();void publicationRoute();}
window.addEventListener('hashchange',()=>{persistReading();if(state?.settings?.onboarding_complete)void publicationRoute();});
async function loadEditions(){editions=(await api('/publication/editions')).editions||[];return editions;}
const editionById=id=>editions.find(e=>e.id===id);
const dateLabel=value=>new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',timeZone:state.settings.timezone||'UTC'}).format(new Date(value));
const readableStatus=e=>['ready','sent','partial'].includes(e.preparation?.status);
function editionList(e){return `<a class="edition-link" href="#edition/${esc(e.id)}"><span class="micro-label">${esc(e.kind==='tonight'?'Tonight’s Reading':'Daily edition')} · ${esc(dateLabel(e.created_at))}</span><h2>${esc(e.title)}</h2><p>${e.featured.length} featured originals · approximately ${e.featured_minutes} min<span class="publication-item-meta">Complete edition: ${e.items.length} originals · ${e.minutes} min</span></p><span class="quiet-link">Open edition →</span></a>`;}
async function publicationRoute(){
  if(!currentReading){try{currentReading=JSON.parse(sessionStorage.getItem(readingContextKey())||'null');}catch{}}
  const epoch=++publicationEpoch,route=currentRoute();readerFrame=null;
  try{
    if(route==='explore')return explorePage();
    if(route==='editor')return await editorPage(epoch);
    publicationShell('<p class="loading-state" role="status">Opening your publication…</p>',route==='library'?'library':'today');
    if(!editions.length||route==='today'||route==='library')await loadEditions();if(epoch!==publicationEpoch)return;
    if(route.startsWith('delivery/'))return await deliveryStatusPage(route.split('/')[1],route.split('/')[2]);
    if(route.startsWith('edition/')){const e=editionById(route.split('/')[1]);if(!e)throw new Error('This edition could not be found.');return editionPage(e);}
    if(route.startsWith('read/'))return await readPage({edition_id:route.split('/')[1],position:Number(route.split('/')[2]),reader_path:route.split('/')[3]==='featured'?'featured':'complete'},epoch);
    if(route.startsWith('raw/'))return await readPage({article_id:route.split('/')[1]},epoch);
    if(route==='library')return await libraryPage(epoch);
    return todayPage();
  }catch(err){if(epoch!==publicationEpoch)return;publicationShell(`<h1>Couldn’t open this page.</h1><p role="alert">${esc(err.message)}</p><button class="btn primary" id="retry-publication">Try again</button><p><a href="#explore">Your sources and chronological feed →</a></p>`);document.querySelector('#retry-publication').onclick=()=>publicationRoute();}
}
function todayPage(){
  const daily=editions.find(e=>e.kind==='daily'),tonight=editions.find(e=>e.kind==='tonight');
  publicationShell(`<div class="publication-dateline">${esc(new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:state.settings.timezone||'UTC'}).format(new Date()))}</div>
    <section class="today-edition"><span class="micro-label">Your personal publication</span><h1>A little room<br>for a longer read.</h1>
      ${daily?editionList(daily):'<p>Your first publication is waiting to take shape.</p>'}
      <div class="issue-actions"><button class="btn ${daily?'':'primary'}" id="prepare-publication">${daily?'Compose a current edition':'Compose my edition'}</button><a class="btn" href="#editor">Talk with your editor</a></div>
      <p class="publication-footnote">A featured path, then further reading. Every eligible subscribed original stays in the complete edition.</p>
    </section>
    <section class="tonight-section"><span class="micro-label">A deliberate detour</span><h2>Tonight’s Reading</h2>${tonight?editionList(tonight):'<p>History, science, and stories you wouldn’t think to look for.</p>'}<form id="tonight-form"><label for="night-minutes">Time for reading</label><div class="night-controls"><select class="select" id="night-minutes"><option value="20">About 20 minutes</option><option value="35" selected>About 35 minutes</option><option value="50">About 50 minutes</option></select><button class="btn" id="compose-tonight">Find me a detour →</button></div></form></section>`);
  document.querySelector('#prepare-publication').onclick=async e=>{e.currentTarget.disabled=true;editionRequest??=crypto.randomUUID();try{const r=await api('/publication/prepare',{method:'POST',body:{request_key:editionRequest}});await preparationPage(r.job.id);}catch(err){toast(err.message);e.currentTarget.disabled=false;}};
  document.querySelector('#tonight-form').onsubmit=async e=>{e.preventDefault();const minutes=Number(document.querySelector('#night-minutes').value);await startNight('Find me something interesting and surprising, not related to work.',minutes);};
}
async function preparationPage(jobId){
  const epoch=++publicationEpoch;
  publicationShell('<span class="micro-label">The editor’s desk</span><h1>Your edition is taking shape.</h1><p>Originals are being prepared and arranged into a finite publication. Nothing is sent until you choose.</p><p id="preparation-status" role="status">Preparing…</p><a class="btn" href="#explore">Browse your sources while you wait</a>');
  for(let n=0;n<50&&epoch===publicationEpoch;n++){
    const r=await api('/publication/job?id='+encodeURIComponent(jobId));if(epoch!==publicationEpoch)return;
    document.querySelector('#preparation-status').textContent=r.job.error?`${r.job.status}: ${r.job.error}`:r.job.status==='running'?'Preparing original articles and the edition…':r.job.status==='queued'?'Queued for preparation…':r.job.status;
    if(r.edition_id&&r.job.status==='ready'){editionRequest=null;nightRequest=null;await loadEditions();location.hash='edition/'+r.edition_id;return;}
    if(['failed','empty','expired'].includes(r.job.status)){document.querySelector('#preparation-status').textContent=r.job.error||'No new eligible reading was available. Your sources remain accessible.';return;}
    await new Promise(r=>setTimeout(r,2500));
  }
  if(epoch===publicationEpoch)document.querySelector('#preparation-status').innerHTML='Preparation is continuing. <button class="btn" id="resume-preparation">Check again</button>';
  const resume=document.querySelector('#resume-preparation');if(resume)resume.onclick=()=>preparationPage(jobId);
}
function itemRow(e,item,index,path='complete'){const number=path==='featured'?e.featured.indexOf(index)+1:index+1;return `<a class="publication-item" href="${esc(readerHref({edition_id:e.id,position:index,reader_path:path}))}"><span class="article-number">${String(number).padStart(2,'0')}</span><span><span class="publication-item-meta">${esc(item.source)} · ${item.minutes} min · ${esc(item.origin)}</span><h3>${esc(item.title)}</h3>${item.editorial_topic?`<span class="small muted">${esc(item.editorial_topic)}</span>`:''}</span><span aria-hidden="true">↗</span></a>`;}
function editionPage(e){
  currentReading={edition_id:e.id,edition_title:e.title};rememberReading();
  const featured=e.featured||[],rest=e.items.map((_,i)=>i).filter(i=>!featured.includes(i));
  publicationShell(`<a class="quiet-link" href="#today">← Today</a><div class="publication-dateline">${esc(dateLabel(e.created_at))} · ${e.items.length} originals</div><h1>${esc(e.title)}</h1>
    ${e.introduction?`<p class="edition-introduction">${esc(e.introduction)}</p>`:''}
    <div class="edition-actions">${featured.length?`<a class="btn primary" href="${esc(readerHref({edition_id:e.id,position:featured[0],reader_path:'featured'}))}">Read the edition</a>`:''}<button class="btn" id="send-edition" ${readableStatus(e)?'':'disabled'}>Send this edition to Kindle</button><button class="btn" id="explain-lead">Why this lead?</button></div>
    <section class="featured-reading"><div class="publication-section-head"><h2>${e.kind==='tonight'?'Your reading tonight':'Start here'}</h2><span class="micro-label">Approximately ${e.featured_minutes} min</span></div>${featured.map(i=>itemRow(e,e.items[i],i,'featured')).join('')}<div class="edition-end"><span>◆</span><p>End of ${e.kind==='tonight'?'tonight’s edition':'the featured reading'}.</p><p class="small">You can stop here.</p></div></section>
    ${rest.length?`<details class="further-reading"><summary>Further reading · ${rest.length} originals · ${e.minutes-e.featured_minutes} min</summary><p class="small">The rest of your complete edition. These subscribed originals remain yours to read; there is no inbox to clear.</p>${rest.map(i=>itemRow(e,e.items[i],i)).join('')}<div class="edition-end">End of the complete edition.</div></details>`:''}
    ${e.issues?.length?`<details class="edition-diagnostics"><summary>Preparation notes (${e.issues.length})</summary>${e.issues.map(s=>`<p class="small">${esc(s)}</p>`).join('')}</details>`:''}
    ${e.editorial?.organization?.status==='fallback'||e.editorial?.organization?.status==='skipped'?'<p class="notice">The AI editor was unavailable during composition. All eligible originals are retained in a deterministic order.</p>':''}`);
  document.querySelector('#send-edition').onclick=()=>sendEdition(e);
  document.querySelector('#explain-lead').onclick=()=>{currentReading={edition_id:e.id};rememberReading();location.hash='editor';sessionStorage.setItem('longFormEditorQuestion','Why did you put this article first?');};
}
async function readPage(context,epoch){
  const r=await api('/reader/article',{method:'POST',body:context});if(epoch!==publicationEpoch)return;
  readerParagraphs=r.paragraphs||[];
  currentReading={...context,article_key:r.article_key,paragraph:r.reading.paragraph||0,progress:r.reading.progress||0,title:r.article.title,saved:r.reading.saved};
  const cached=JSON.parse(localStorage.getItem(localReadingKey(r.article_key))||'null');if(cached&&cached.updated_at>Date.parse(r.reading.updated_at||0)){currentReading.progress=cached.progress;currentReading.paragraph=cached.paragraph;}
  const e=context.edition_id?editionById(context.edition_id):null;
  const path=context.reader_path==='featured'&&e?e.featured:e?.items.map((_,i)=>i)||[],at=path.indexOf(context.position);
  rememberReading();
  publicationShell(`<div class="reader-toolbar"><a class="quiet-link" href="${e?'#edition/'+esc(e.id):'#explore'}">← ${e?'Edition':'Explore'}</a><button class="btn" id="save-reading">${currentReading.saved?'Saved':'Save'}</button></div><div class="publication-item-meta">${esc(r.article.author||r.article.source)} · ${esc(r.article.source)} · ${esc(r.article.origin||'Original article')}</div><h1 class="reader-title">${esc(r.article.title)}</h1>
    ${r.article.warnings?.length?`<details><summary>Article preparation notes</summary>${r.article.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</details>`:''}
    <iframe class="publication-reader" id="original-reader" sandbox="allow-same-origin" title="${esc(r.article.title)}" referrerpolicy="no-referrer"></iframe>
    <div class="reader-bottom"><button class="btn primary" id="discuss-reading">Discuss with your editor</button><a class="btn" href="${esc(safeHref(r.article.canonical_url||r.article.url))}" target="_blank" rel="noopener noreferrer">Original source ↗</a></div>
    ${e?`<div class="reader-pagination">${at>0?`<a class="btn" href="${esc(readerHref({...context,position:path[at-1]}))}">← Previous</a>`:'<span></span>'}${at>=0&&at<path.length-1?`<a class="btn" href="${esc(readerHref({...context,position:path[at+1]}))}">Next original →</a>`:`<a class="btn" href="#edition/${esc(e.id)}">End of ${context.reader_path==='featured'&&e.kind==='daily'?'featured reading':'edition'} ◆</a>`}</div>`:''}`);
  readerFrame=document.querySelector('#original-reader');
  // Article HTML is sanitized by the extraction pipeline. No scripts or active
  // permissions are granted. Data images are the frozen publication bytes.
  readerFrame.srcdoc=`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><style>html{background:#f7f5f0}body{margin:16px 0 50px;color:#28342e;font:20px/1.75 Georgia,serif;overflow-wrap:anywhere}h1,h2,h3{line-height:1.2}img{max-width:100%;height:auto}pre{white-space:pre-wrap;font-size:.8em}table{display:block;max-width:100%;overflow-x:auto}blockquote{margin:1em 0;border-left:2px solid #d8d9ce;padding-left:16px}a{color:#913d30}figure{margin:1em 0}p{margin:0 0 1.1em}</style><body>${r.article.body}</body></html>`;
  readerFrame.onload=()=>{const doc=readerFrame?.contentDocument;if(!doc)return;const max=doc.documentElement.scrollHeight-readerFrame.clientHeight;doc.defaultView.scrollTo(0,Math.max(0,max)*currentReading.progress);doc.defaultView.addEventListener('scroll',()=>{clearTimeout(readingSaveTimer);readingSaveTimer=setTimeout(persistReading,300);},{passive:true});};
  document.querySelector('#discuss-reading').onclick=()=>{persistReading();location.hash='editor';};
  document.querySelector('#save-reading').onclick=async ev=>{currentReading.saved=!currentReading.saved;try{await api('/reader/state',{method:'PATCH',body:{...context,saved:currentReading.saved}});ev.target.textContent=currentReading.saved?'Saved':'Save';}catch(err){currentReading.saved=!currentReading.saved;toast(err.message);}};
}
function persistReading(){
  if(!readerFrame?.contentDocument||!currentReading?.article_key)return;
  const doc=readerFrame.contentDocument,max=Math.max(1,doc.documentElement.scrollHeight-readerFrame.clientHeight),y=doc.defaultView.scrollY;
  currentReading.progress=Math.min(1,Math.max(0,y/max));
  const selector='p,h1,h2,h3,h4,h5,h6,li,blockquote,pre',ps=[...doc.querySelectorAll(selector)].filter(p=>!p.querySelector(selector));
  const visible=ps.find(p=>p.getBoundingClientRect().bottom>10&&(p.textContent||'').trim()),text=(visible?.textContent||'').replace(/\s+/g,' ').trim();
  const number=text?readerParagraphs.findIndex(p=>p.includes(text)): -1;if(number>=0)currentReading.paragraph=number;
  localStorage.setItem(localReadingKey(currentReading.article_key),JSON.stringify({progress:currentReading.progress,paragraph:currentReading.paragraph,updated_at:Date.now()}));
  rememberReading();
  void api('/reader/state',{method:'PATCH',body:{...currentReading,progress:currentReading.progress,paragraph:currentReading.paragraph}}).catch(()=>{});
}
function explorePage(){
  legacyDashboard();
  const home=document.querySelector('.home-dashboard');home.querySelector('.issue-card').hidden=true;home.querySelector('.editor-card').hidden=true;
  home.insertAdjacentHTML('beforebegin',publicationNav('explore')+'<div class="publication-dateline">Trusted editorial inputs</div><h1>Explore</h1>');
  home.querySelector('.library-card').insertAdjacentHTML('beforeend','<div class="mt-5"><button class="btn" id="raw-feed">Chronological feed →</button></div>');
  document.querySelector('#raw-feed').onclick=rawFeedPage;
}
async function rawFeedPage(){
  const epoch=++publicationEpoch;publicationShell('<h1>Chronological feed</h1><p role="status">Fetching your subscribed sources…</p>','explore');
  try{const r=await api('/publication/feed');if(epoch!==publicationEpoch)return;
    publicationShell(`<a class="quiet-link" href="#explore">← Sources</a><h1>Chronological feed</h1><p>Recent entries from your subscriptions, in date order. Your editor does not filter this view.</p>${r.feeds.filter(f=>f.error).map(f=>`<p class="notice">${esc(f.name)}: ${esc(f.error)}</p>`).join('')}<div class="raw-feed-list">${r.items.map((a,i)=>`<button class="raw-feed-item" data-index="${i}"><span class="publication-item-meta">${esc(a.source)}${a.published_at?' · '+esc(dateLabel(a.published_at)):''}</span><h3>${esc(a.title)}</h3></button>`).join('')||'<p>No current entries were returned.</p>'}</div><p class="small muted">Up to 100 available recent entries per active source. Publisher feed retention determines what is available.</p>`,'explore');
    document.querySelectorAll('.raw-feed-item').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const a=await api('/reader/open',{method:'POST',body:{url:r.items[Number(b.dataset.index)].url}});location.hash='raw/'+a.article_id;}catch(err){toast(err.message);b.disabled=false;}});
  }catch(err){publicationShell(`<h1>Chronological feed</h1><p role="alert">${esc(err.message)}</p><a class="btn" href="#explore">Return to sources</a>`,'explore');}
}
function messageHtml(m){const r=m.response||{};return `<article class="editor-exchange"><p class="editor-question">${esc(m.question)}</p><div class="editor-answer ${r.unavailable?'notice':''}">${esc(r.answer).replace(/\n/g,'<br>')}</div>${r.citations?.length?`<div class="editor-evidence">${r.citations.map(c=>`<a href="${c.edition_id?'#read/'+esc(c.edition_id)+'/'+c.position:esc(safeHref(c.url))}" ${c.edition_id?'':'target="_blank" rel="noopener noreferrer"'}>${esc(c.title||'Original passage')}${c.delivered_at?' · submitted '+esc(dateLabel(c.delivered_at)):''}</a>`).join('')}</div>`:''}
    ${m.proposed_guidance?`<div class="preference-proposal"><p class="small">Temporary conversation guidance: ${esc(m.proposed_guidance)}</p>${m.confirmed_at?'<p class="micro-label">Saved for future nighttime editions</p>':`<button class="btn confirm-guidance" data-id="${esc(m.id)}">Save as my nighttime preferences</button>`}</div>`:''}
    ${r.compose_request?`<button class="btn primary compose-request" data-request="${esc(m.id)}">Compose this reading edition</button>`:''}${r.send_request?`<button class="btn primary review-send-request" data-request="${esc(m.id)}">Review exact edition for Kindle</button>`:''}</article>`;}
async function editorPage(epoch){
  publicationShell('<h1>Your editor</h1><p role="status">Opening your conversation…</p>','editor');
  const h=await api('/editor/history');if(epoch!==publicationEpoch)return;
  publicationShell(`<div class="editor-page-head"><span class="micro-label">The same editor, across your reading</span><h1>Your editor</h1><button class="btn" id="editor-preferences">Editorial brief & preferences</button></div>
    ${currentReading?.title?`<div class="reading-context"><span class="micro-label">Reading context</span><p>${esc(currentReading.title)}</p><a class="btn" href="${esc(readerHref(currentReading))}">Return to reading →</a></div>`:currentReading?.edition_id?`<p class="small">Discussing ${esc(currentReading.edition_title||'the edition you just opened')}.</p><a class="quiet-link" href="#edition/${esc(currentReading.edition_id)}">Return to edition →</a>`:'<p>Steer your reading, ask about past editions, or find a deliberate detour.</p>'}
    <div id="editor-messages" aria-live="polite">${h.messages.map(messageHtml).join('')}</div><form class="editor-conversation-form" id="editor-conversation"><label for="editor-question">Talk with your editor</label><textarea class="input" id="editor-question" rows="3" maxlength="4000" placeholder="I have about 35 minutes tonight…" required></textarea><button class="btn primary" id="ask-editor" ${editorBusy?'disabled':''}>Ask your editor</button><p class="small muted">Conversation steering is temporary. Saving preferences requires your confirmation.</p></form>`,'editor');
  document.querySelector('#editor-preferences').onclick=editorModal;
  wireEditorMessages(h.messages);
  const q=sessionStorage.getItem('longFormEditorQuestion');if(q){document.querySelector('#editor-question').value=q;sessionStorage.removeItem('longFormEditorQuestion');}
  document.querySelector('#editor-conversation').onsubmit=async ev=>{
    ev.preventDefault();if(editorBusy)return;editorBusy=true;const field=document.querySelector('#editor-question'),question=field.value;const button=document.querySelector('#ask-editor');button.disabled=true;button.textContent='Considering your reading…';
    try{const r=await api('/editor/message',{method:'POST',body:{question,request_key:crypto.randomUUID(),...currentReading}});if(epoch!==publicationEpoch)return;document.querySelector('#editor-messages').insertAdjacentHTML('beforeend',messageHtml(r.message));field.value='';h.messages.push(r.message);wireEditorMessages(h.messages);document.querySelector('#editor-messages').lastElementChild.scrollIntoView({block:'start',behavior:'smooth'});if(r.message.response?.compose_request){const c=r.message.response.compose_request;await startNight(c.request,c.minutes);}else if(r.message.response?.send_request){await reviewEditorSend(r.message);}}
    catch(err){toast(err.message);}finally{editorBusy=false;if(button.isConnected){button.disabled=false;button.textContent='Ask your editor';}}
  };
}
function wireEditorMessages(messages){
  document.querySelectorAll('.confirm-guidance').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/editor/confirm',{method:'POST',body:{message_id:b.dataset.id}});b.textContent='Saved for future nighttime editions';}catch(err){toast(err.message);b.disabled=false;}});
  document.querySelectorAll('.compose-request').forEach(b=>b.onclick=()=>{const m=messages.find(m=>m.id===b.dataset.request);if(m)void startNight(m.response.compose_request.request,m.response.compose_request.minutes);});
  document.querySelectorAll('.review-send-request').forEach(b=>b.onclick=()=>{const m=messages.find(m=>m.id===b.dataset.request);if(m)void reviewEditorSend(m);});
}
async function reviewEditorSend(message){
  try{if(!editionById(message.response.send_request.edition_id))await loadEditions();const e=editionById(message.response.send_request.edition_id);if(!e)throw new Error('Open the edition before sending it.');await sendEdition(e);}catch(err){toast(err.message);}
}
async function startNight(request,minutes){
  nightRequest??=crypto.randomUUID();publicationShell('<span class="micro-label">Tonight’s Reading</span><h1>Finding a deliberate detour.</h1><p role="status">Your editor is checking original articles, recent editions, and your reading brief. Nothing is sent automatically.</p>');
  try{const r=await api('/publication/compose',{method:'POST',timeout:140000,body:{request,minutes,request_key:nightRequest}});await preparationPage(r.job.id);}
  catch(err){publicationShell(`<h1>Tonight’s Reading</h1><p role="alert">${esc(err.message)}</p><button class="btn" id="retry-night">Try again</button><a class="btn" href="#today">Today</a>`);document.querySelector('#retry-night').onclick=()=>startNight(request,minutes);}
}
async function sendEdition(e){
  if(!state.settings.kindle_email){settingsModal();return;}
  const storageKey=`longFormEditionSend:${state.user.id}:${e.id}`;let requestKey=localStorage.getItem(storageKey);if(!requestKey){requestKey=crypto.randomUUID();localStorage.setItem(storageKey,requestKey);}
  openModal(`<h2>Send the exact edition</h2><p>${e.items.length} originals, in the complete edition’s order, to <strong>${esc(state.settings.kindle_email)}</strong>.</p><p class="small">${e.kind==='daily'?'This includes further reading as well as the featured path. ':''}The prepared EPUB is reused exactly. Submission status does not confirm arrival on your Kindle.</p><button class="btn primary" id="confirm-edition-send">Send this edition</button><button class="btn" id="close-modal">Cancel</button>`);
  document.querySelector('#close-modal').onclick=closeModal;
  document.querySelector('#confirm-edition-send').onclick=async b=>{b.currentTarget.disabled=true;try{const r=await api('/publication/send',{method:'POST',body:{edition_id:e.id,request_key:requestKey}});closeModal(true);location.hash=`delivery/${r.job_id}/${e.id}`;}catch(err){toast(err.message);b.currentTarget.disabled=false;}};
}
async function deliveryStatusPage(jobId,editionId){
  const epoch=++publicationEpoch;publicationShell(`<span class="micro-label">Kindle delivery</span><h1 id="delivery-title">Edition queued.</h1><p id="delivery-status" role="status">Checking the production delivery path…</p><div id="delivery-issues"></div><a class="btn" href="#edition/${esc(editionId)}">Return to your edition</a>`);
  for(let n=0;n<50&&epoch===publicationEpoch;n++){
    const r=await api('/publication/job?id='+encodeURIComponent(jobId));if(epoch!==publicationEpoch)return;
    const s=r.job.status;document.querySelector('#delivery-status').textContent=({queued:'Queued for delivery.',running:'Submitting your frozen edition…',sent:'Accepted by the email provider. Arrival on your Kindle is not confirmed.',partial:'Accepted by the email provider with preparation notes. These may include omissions; review them below; arrival on Kindle is not confirmed.',failed:'Delivery failed. Nothing is claimed as delivered.'})[s]||s;
    document.querySelector('#delivery-issues').innerHTML=[r.job.error,...(r.job.result?.issues||[])].filter(Boolean).map(v=>`<p class="notice">${esc(v)}</p>`).join('');
    if(['sent','partial','failed','empty','expired'].includes(s)){document.querySelector('#delivery-title').textContent=s==='sent'?'Edition submitted.':s==='partial'?'Submitted with notes.':'Delivery needs attention.';return;}
    await new Promise(r=>setTimeout(r,2500));
  }
}
async function libraryPage(epoch){
  const lib=await api('/reader/library');if(epoch!==publicationEpoch)return;
  const saved=lib.states.filter(s=>s.saved).map(s=>{if(s.article_key.startsWith('raw:')){const a=lib.articles.find(a=>a.id===s.article_key.slice(4));return a?`<a class="library-saved" href="#raw/${esc(a.id)}">${esc(a.title)}</a>`:'';}const [id,index]=s.article_key.split(':');const e=editionById(id);return e?.items[index]?`<a class="library-saved" href="#read/${esc(id)}/${index}">${esc(e.items[index].title)}</a>`:'';});
  publicationShell(`<h1>Your library</h1><p>Publications you can return to. No unread count, no clearing required.</p><button class="btn" id="library-delivery-history">Delivery history →</button><section class="saved-reading"><h2>Saved reading</h2>${saved.join('')||'<p class="muted">Save an original from the reader to keep it here.</p>'}</section><section><h2>Past editions</h2>${editions.map(editionList).join('')||'<p>No editions yet.</p>'}</section>`,'library');
  document.querySelector('#library-delivery-history').onclick=historyModal;
}
