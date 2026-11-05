'use strict';
/* Security headers, the same-site check for writes, and small rate limiters. */

/*
 * Content Security Policy. Scripts and styles only come from this site
 * (plus Google Fonts); embeds only from the streaming players the Big
 * Screen supports. Emotes and badges come from many CDNs, so images may
 * load from any https address. Chat connects to Twitch, Kick (through the
 * relay), YouTube, 7TV and decapi over https/wss.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  'frame-src https://player.twitch.tv https://player.kick.com https://www.youtube.com https://www.youtube-nocookie.com https://rumble.com https://angelthump.com',
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function isHttps(req) {
  return req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
}

function setHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/**
 * Writes must come from this site. Browsers always send Origin on POST
 * from scripts, so a mismatch means another site is trying to post with
 * the visitor's cookie. (The X-Ater header check catches the rest.)
 */
function sameSite(req, publicUrl) {
  const origin = req.headers.origin;
  if (!origin) return true; // not a browser cross-site request (curl, tests, server-to-server)
  let o;
  try { o = new URL(origin); } catch { return false; }
  if (publicUrl) { try { if (o.host === new URL(publicUrl).host) return true; } catch { /* bad config */ } }
  return o.host === req.headers.host;
}

/** limiter(5, 3600000)(key) -> true when key went over 5 hits in an hour. */
function limiter(max, windowMs) {
  const hits = new Map();
  const sweep = setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (t - v.t > windowMs) hits.delete(k); }, windowMs);
  sweep.unref();
  return (key) => {
    const t = Date.now();
    const r = hits.get(key) || { n: 0, t };
    if (t - r.t > windowMs) { r.n = 0; r.t = t; }
    r.n++; hits.set(key, r);
    return r.n > max;
  };
}

module.exports = { setHeaders, sameSite, limiter, isHttps, CSP };
