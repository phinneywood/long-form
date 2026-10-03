import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/oauth/[route].js';
import { readFileSync } from 'node:fs';

test('authorization HTML renders as UTF-8 with PKCE query and security headers retained', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url.origin, 'https://wuikfmmwvrzpaoevtskn.supabase.co');
    assert.equal(url.pathname, '/functions/v1/oauth/authorize');
    assert.equal(url.search, '?state=abc&code_challenge=def&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcallback');
    assert.equal(init.redirect, 'manual');
    return new Response('<!doctype html><html><body>You’ll connect ✓</body></html>', {
      headers: { 'Content-Type': 'text/plain; charset=iso-8859-1' },
    });
  };
  try {
    const r = await handler(new Request('https://reader.antonioskilton.com/api/oauth/authorize?state=abc&code_challenge=def&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcallback'));
    assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-security-policy'), /form-action 'self'/);
    assert.match(await r.text(), /You’ll connect ✓/);
  } finally { globalThis.fetch = original; }
});

test('OTP form bytes and validation errors survive; successful callback is never fetched', async () => {
  const original = globalThis.fetch;
  const payload = 'email=test%40example.com&code=123456&state=abc';
  let redirect = false;
  globalThis.fetch = async (url, init) => {
    assert.equal(url.pathname, '/functions/v1/oauth/verify-code');
    assert.equal(new TextDecoder().decode(init.body), payload);
    assert.equal(init.headers.get('content-type'), 'application/x-www-form-urlencoded');
    return redirect
      ? new Response(null, { status: 302, headers: { Location: 'https://chatgpt.com/callback?code=opaque&state=abc' } })
      : new Response('<!doctype html><html>Invalid code</html>', { status: 401, headers: { 'Content-Type': 'text/plain' } });
  };
  const request = () => new Request('https://reader.antonioskilton.com/oauth/verify-code', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: payload,
  });
  try {
    const error = await handler(request());
    assert.equal(error.status, 401);
    assert.equal(error.headers.get('content-type'), 'text/html; charset=utf-8');
    redirect = true;
    const success = await handler(request());
    assert.equal(success.status, 302);
    assert.equal(success.headers.get('location'), 'https://chatgpt.com/callback?code=opaque&state=abc');
  } finally { globalThis.fetch = original; }
});

test('proxy is restricted to browser OAuth routes and allowed methods', async () => {
  assert.equal((await handler(new Request('https://reader.antonioskilton.com/api/oauth/token'))).status, 404);
  assert.equal((await handler(new Request('https://reader.antonioskilton.com/api/oauth/authorize', { method: 'POST' }))).status, 405);
  const rewrites = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url))).rewrites;
  for (const route of ['authorize', 'request-code', 'verify-code', 'reviewer-login', 'test-callback']) {
    assert.equal(rewrites.find(r => r.source === `/oauth/${route}`).destination, `/api/oauth/${route}`);
  }
});
