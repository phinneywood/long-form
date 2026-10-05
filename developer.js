/* Developer-only replay. No production credentials or authentication bypass. */
const frame=document.querySelector('#qa-frame'),status=document.querySelector('#qa-status');
let snapshot=null;
function replay(data,scenario){
  const clone=value=>JSON.parse(JSON.stringify(value)),memory=()=>{const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()}};
  window.qaLocalStorage=memory();window.qaSessionStorage=memory();qaLocalStorage.setItem('longFormToken','snapshot-replay');
  window.fetch=async(url,options={})=>{
    const path=String(url).split('/app-api')[1]?.split('?')[0],body=options.body?JSON.parse(options.body):null;
    let result,code=200;
    if(scenario==='error'&&path==='/publication/editions'){result={error:'Captured edition API failure.'};code=503;}
    else if(scenario==='empty'&&path==='/publication/editions')result={editions:[]};
    else if(path==='/reader/article')result=data.articles[body.edition_id?`${body.edition_id}:${body.position}`:`raw:${body.article_id}`];
    else if(path==='/reader/state'){
      const key=body.article_key||(body.edition_id?`${body.edition_id}:${body.position}`:`raw:${body.article_id}`),article=data.articles[key];
      if(article){article.reading={...article.reading,...body,updated_at:new Date().toISOString()};const states=data.responses['/reader/library'].states;const old=states.find(s=>s.article_key===key);if(old)Object.assign(old,article.reading);else states.push({article_key:key,...article.reading});}
      result={ok:true}; // Replay-local; never persisted to an account.
    }
    else if((options.method||'GET')==='GET')result=data.responses[path];
    if(!result){result={error:'Developer replay: this action needs a live validation test. No request was sent.'};code=409;}
    return new Response(JSON.stringify(clone(result)),{status:code,headers:{'Content-Type':'application/json'}});
  };
  // Keep hash navigation inside this srcdoc, rather than resolving against the parent page.
  document.addEventListener('click',event=>{const a=event.target.closest('a[href^="#"]');if(a){event.preventDefault();location.hash=a.getAttribute('href').slice(1);}});
}
async function reset(){
  if(!snapshot)return;
  const response=await fetch('/');if(!response.ok)throw Error('Could not load the current application.');
  let html=await response.text();
  // Inline the publication script too, so all storage stays in replay memory.
  const publication=await fetch('/publication.js');if(!publication.ok)throw Error('Could not load the current publication interface.');
  const publicationText=await publication.text();
  html=html.replace('<script src="/publication.js"></script>',()=>`<script>${publicationText.replace(/<\/script/gi,'<\\/script')}<\/script>`);
  html=html.replace(/\blocalStorage\b/g,'qaLocalStorage').replace(/\bsessionStorage\b/g,'qaSessionStorage');
  const payload=JSON.stringify(snapshot).replace(/</g,'\\u003c');
  const scenario=JSON.stringify(document.querySelector('#qa-scenario').value);
  html=html.replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data:; font-src 'self'; frame-src 'self'; connect-src 'none';"><script>(${replay.toString()})(${payload},${scenario})<\/script>`);
  frame.srcdoc=html;
  status.textContent=`Replaying ${Object.keys(snapshot.articles).length} captured originals. No live API calls, account changes, or sends.`;
}
async function loadSnapshot(text){try{if(text.length>40*1024*1024)throw Error('Snapshot exceeds 40 MB.');const data=JSON.parse(text);if(data.version!==1||!data.responses?.['/me']||!data.responses?.['/publication/editions']||!data.articles)throw Error('Choose a Long Form validation snapshot.');if(!/@resend\.dev$/.test(data.responses['/me'].user.email)||!data.responses['/me'].settings.paused)throw Error('Only paused validation accounts are supported.');snapshot=data;await reset();}catch(error){status.textContent=error.message;}}
document.querySelector('#qa-file').onchange=async event=>{const file=event.target.files[0];if(file)await loadSnapshot(await file.text());};
document.querySelector('#qa-load').onclick=()=>loadSnapshot(document.querySelector('#qa-json').value);
document.querySelector('#qa-width').onchange=event=>frame.style.width=`${Number(event.target.value)}px`;
document.querySelector('#qa-reset').onclick=reset;
document.querySelector('#qa-scenario').onchange=reset;
