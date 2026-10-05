import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';
import handler from '../api/oauth/[route].js';

// Entirely local fixture: no credentials, email, or real OAuth callback.
const form = '<!doctype html><form method="post" action="/oauth/verify-code"><button>Connect</button></form>';
const original = globalThis.fetch;
globalThis.fetch = async () => new Response(form, { headers: { 'Content-Type': 'text/plain' } });
let fixedPolicy;
try {
  fixedPolicy = (await handler(new Request('https://long-form.test/oauth/authorize'))).headers.get('content-security-policy');
} finally { globalThis.fetch = original; }
assert.match(fixedPolicy, /form-action 'self' https:\/\/chatgpt\.com;/);

let callbackReached = false;
const callback = createServer((req, res) => {
  callbackReached = true;
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Connected</h1>');
});
await new Promise(resolve => callback.listen(0, '127.0.0.1', resolve));
const callbackOrigin = `http://127.0.0.1:${callback.address().port}`;
let policy;
const auth = createServer((req, res) => {
  if (req.method === 'POST') {
    req.resume();
    res.writeHead(302, { Location: `${callbackOrigin}/callback?code=fixture` });
    res.end();
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': policy });
    res.end(form);
  }
});
await new Promise(resolve => auth.listen(0, '127.0.0.1', resolve));
const authOrigin = `http://127.0.0.1:${auth.address().port}`;
const requested = process.argv.slice(2);
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !requested.length || requested.includes(name));
assert.ok(engines.length, 'Choose chromium or webkit');
try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const fixed of [false, true]) {
        policy = fixed ? fixedPolicy.replace('https://chatgpt.com', callbackOrigin) : fixedPolicy.replace(' https://chatgpt.com', '');
        callbackReached = false;
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.goto(`${authOrigin}/oauth/authorize`);
          await page.getByRole('button', { name: 'Connect' }).click();
          if (fixed) await page.getByRole('heading', { name: 'Connected' }).waitFor({ timeout: 5000 });
          else await page.waitForTimeout(500);
          assert.equal(callbackReached, fixed, `${name}: callback should be blocked only by the old policy`);
        } finally { await context.close(); }
      }
      console.log(`${name}: reproduced old-policy failure; fixed policy completes callback`);
    } finally { await browser.close(); }
  }
} finally {
  await Promise.all([new Promise(resolve => auth.close(resolve)), new Promise(resolve => callback.close(resolve))]);
}
