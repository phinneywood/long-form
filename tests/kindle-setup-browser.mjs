/** Minimal-account onboarding; all API calls are intercepted, never send email. */
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import http from 'node:http';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const reader={user:{id:'test-user',email:'reader@example.com'},settings:{onboarding_complete:false,kindle_email:null,paused:true,delivery_time:'06:00',timezone:'UTC'},sections:[],sources:[],jobs:[],digests:[]};
const files={'/':'index.html','/styles.css':'styles.css','/publication.css':'publication.css','/publication.js':'publication.js','/opml.js':'opml.js','/starter-editions.js':'starter-editions.js'};
const server=http.createServer(async(req,res)=>{const f=files[new URL(req.url,'http://local').pathname];if(!f){res.writeHead(404);return res.end();}res.setHeader('Content-Type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'application/javascript':'text/html');res.end(await fs.readFile(path.join(root,f)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await(process.env.BROWSER==='webkit'?webkit:chromium).launch();let calls=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin===base)return route.continue();
  const endpoint=u.pathname.split('/app-api')[1];calls.push(endpoint);let data;
  if(endpoint==='/auth/request-code')data={};
  else if(endpoint==='/auth/verify-code')data={...reader,token:'fake-browser-session'};
  else if(endpoint==='/me')data=reader;
  else if(endpoint==='/kindle'){const b=route.request().postDataJSON();assert.equal(b.kindle_email,'provided@kindle.com');assert.deepEqual(Object.keys(b),['kindle_email']);reader.settings={...reader.settings,onboarding_complete:true,kindle_email:b.kindle_email,paused:true};data={address_configured:true};}
  else if(endpoint==='/publication/editions')data={editions:[]};
  else throw Error('Unexpected capability '+endpoint);
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(base+'/?setup=kindle');await page.locator('#email').fill('reader@example.com');await page.locator('#login-submit').click();await page.locator('#code').fill('123456');await page.locator('#verify-form .primary').click();
 await page.locator('#one-time-kindle').waitFor();assert.match(await page.locator('#modal').innerText(),/approved personal-document senders/);await page.locator('#packet-kindle-email').fill('provided@kindle.com');await page.getByRole('button',{name:'Save Kindle setup',exact:true}).click();
 await page.locator('#prepare-publication').waitFor();assert.equal(await page.locator('#one-time-form').count(),0);assert.ok(reader.settings.paused);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 assert.ok(calls.includes('/kindle')&&!calls.some(p=>/queue|send-now|feeds|prepare/.test(p)));assert.deepEqual(errors,[]);
 await page.reload();await page.locator('#prepare-publication').waitFor();assert.equal(calls.filter(p=>p==='/auth/request-code').length,1,'Setup survives reload on the same account');
 console.log('Kindle-only mobile setup: no feeds, schedule, test send or script errors; full reader survives reload.');
}finally{await browser.close();server.close();}
