export const config = { runtime: 'edge' };

const upstreamOrigin = 'https://wuikfmmwvrzpaoevtskn.supabase.co';
const routes = new Map([
  ['authorize', 'GET'], ['request-code', 'POST'], ['verify-code', 'POST'],
  ['reviewer-login', 'POST'], ['test-callback', 'GET'],
]);

// Supabase's shared gateway serves HTML as text/plain. Render only the known
// OAuth pages on our application origin; auth validation remains upstream.
export default async function handler(request) {
  const incoming = new URL(request.url);
  const match = incoming.pathname.match(/^\/(?:api\/)?oauth\/([a-z-]+)$/);
  const route = match?.[1];
  if (!routes.has(route)) return new Response('Not found', { status: 404 });
  if (request.method !== routes.get(route)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: routes.get(route) } });
  }
  const headers = new Headers({ Accept: 'text/html' });
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);
  const upstream = new URL(`/functions/v1/oauth/${route}`, upstreamOrigin);
  upstream.search = incoming.search;
  try {
    const response = await fetch(upstream, {
      method: request.method, headers,
      body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
      redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    // Browsers can apply form-action to the post-login redirect too.
    // ChatGPT is the existing trusted OAuth client, not a new form recipient.
    const outgoing = new Headers({
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com; base-uri 'none'; frame-ancestors 'none'",
    });
    // Do not follow redirects: authorization codes must go only to the validated
    // client callback, never to a server-side fetch of that callback.
    const location = response.headers.get('location');
    if (location && response.status >= 300 && response.status < 400) {
      outgoing.set('Location', location);
      return new Response(null, { status: response.status, headers: outgoing });
    }
    const body = await response.text();
    const isPage = /^\s*<!doctype html>/i.test(body);
    outgoing.set('Content-Type', isPage ? 'text/html; charset=utf-8' : (response.headers.get('content-type') || 'text/plain; charset=utf-8'));
    return new Response(body, { status: response.status, headers: outgoing });
  } catch {
    return new Response('Long Form sign-in is temporarily unavailable. Please try again.', {
      status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
