/*
 * Ater Kick relay — a Cloudflare Worker.
 *
 * Since October 2026 Kick's chat servers only accept connections that come
 * from kick.com, so a web page like Ater can't connect to Kick chat directly.
 * This relay sits in between: the page talks to the relay, the relay talks to
 * Kick without a browser Origin.
 *
 * What it forwards (and nothing else):
 *   POST /api/v1/realtime/*   -> https://web.kick.com/api/v1/realtime/*   (connection + token)
 *   GET  /api/v2/channels/:slug -> https://kick.com/api/v2/channels/:slug (chatroom lookup)
 *   GET  /ws?to=wss://…       -> that Kick WebSocket, piped both ways
 *
 * Settings (wrangler.toml [vars] or the dashboard):
 *   ALLOWED_ORIGINS  comma-separated sites allowed to use this relay, e.g.
 *                    "https://ater.live,http://localhost:8080". "*" allows any.
 *   WS_HOSTS         comma-separated host suffixes the relay may open sockets to.
 *                    Default "kick.com" (covers *.kick.com). Keeps it from being
 *                    an open proxy for any WebSocket on the internet.
 */

const KICK_WEB = 'https://web.kick.com';
const KICK = 'https://kick.com';

function allowedOrigin(req, env) {
  const origin = req.headers.get('Origin') || '';
  const list = String(env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes('*')) return origin || '*';
  return list.includes(origin) ? origin : null;
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const text = (status, msg, headers = {}) => new Response(msg, { status, headers: { 'content-type': 'text/plain', ...headers } });

function wsTargetOk(to, env) {
  let u;
  try { u = new URL(to); } catch { return false; }
  if (u.protocol !== 'wss:') return false;
  const hosts = String(env.WS_HOSTS || 'kick.com').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const host = u.hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith('.' + h));
}

async function relaySocket(req, env, origin) {
  if (req.headers.get('Upgrade') !== 'websocket') return text(426, 'Expected a WebSocket upgrade');
  const to = new URL(req.url).searchParams.get('to') || '';
  if (!wsTargetOk(to, env)) return text(400, 'That WebSocket address is not allowed', cors(origin));

  const upstreamRes = await fetch(to.replace(/^wss:/, 'https:'), { headers: { Upgrade: 'websocket' } });
  const upstream = upstreamRes.webSocket;
  if (!upstream) return text(502, 'Kick refused the socket (' + upstreamRes.status + ')', cors(origin));
  upstream.accept();

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  const closeBoth = (code, reason) => {
    try { server.close(code, reason); } catch {}
    try { upstream.close(code, reason); } catch {}
  };
  server.addEventListener('message', (e) => { try { upstream.send(e.data); } catch { closeBoth(1011, 'upstream send failed'); } });
  upstream.addEventListener('message', (e) => { try { server.send(e.data); } catch { closeBoth(1011, 'client send failed'); } });
  server.addEventListener('close', (e) => closeBoth(e.code || 1000, e.reason));
  upstream.addEventListener('close', (e) => closeBoth(e.code || 1000, e.reason));
  server.addEventListener('error', () => closeBoth(1011, 'client error'));
  upstream.addEventListener('error', () => closeBoth(1011, 'upstream error'));

  return new Response(null, { status: 101, webSocket: client });
}

async function forward(req, target, origin) {
  const init = { method: req.method, headers: { accept: 'application/json' } };
  if (req.method === 'POST') {
    init.headers['content-type'] = 'application/json';
    init.body = await req.text();
  }
  const res = await fetch(target, init);
  const headers = new Headers(cors(origin));
  headers.set('content-type', res.headers.get('content-type') || 'application/json');
  headers.set('cache-control', 'no-store');
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = allowedOrigin(req, env);
    if (origin === null) return text(403, 'This site is not allowed to use the relay');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    if (url.pathname === '/' ) return text(200, 'Ater Kick relay is running.', cors(origin));
    if (url.pathname === '/ws') return relaySocket(req, env, origin);
    if (req.method === 'POST' && url.pathname.startsWith('/api/v1/realtime/')) return forward(req, KICK_WEB + url.pathname, origin);
    if (req.method === 'GET' && /^\/api\/v2\/channels\/[\w-]{1,40}$/.test(url.pathname)) return forward(req, KICK + url.pathname, origin);
    return text(404, 'Not found', cors(origin));
  },
};
