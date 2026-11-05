'use strict';
/* Serves the site from public/ with ETags and gzip. Nothing outside public/ is reachable. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const COMPRESS = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.webmanifest']);

function createStatic(root) {
  root = path.resolve(root);
  const cache = new Map(); // file -> { mtime, raw, gz, etag }

  function load(file, st) {
    const hit = cache.get(file);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit;
    const raw = fs.readFileSync(file);
    const entry = {
      mtime: st.mtimeMs, size: st.size, raw,
      gz: COMPRESS.has(path.extname(file)) ? zlib.gzipSync(raw) : null,
      etag: `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`,
    };
    cache.set(file, entry);
    return entry;
  }

  /** Returns true if it answered the request. */
  return function serve(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return false; }
    if (rel.includes('\0')) return false;
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, path.normalize(rel));
    if (file !== root && !file.startsWith(root + path.sep)) return false;
    let st;
    try { st = fs.statSync(file); } catch { return false; }
    if (!st.isFile()) return false;

    const e = load(file, st);
    const ext = path.extname(file);
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache', // always revalidate; the ETag makes that cheap
      ETag: e.etag,
      Vary: 'Accept-Encoding',
    };
    if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, headers); res.end(); return true; }
    const gzip = e.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const body = gzip ? e.gz : e.raw;
    if (gzip) headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}

module.exports = { createStatic };
