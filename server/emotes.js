'use strict';
/*
 * The built-in Ater emotes, drawn as SVG so they stay sharp at any size.
 * Moderators can add more (PNG, GIF or WebP) from chat settings; those are
 * kept in the data file and served from /api/emote/<name>.
 */
const RAINBOW =
  '<defs><linearGradient id="r" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0" stop-color="#6366f1"/><stop offset=".3" stop-color="#a855f7"/>' +
  '<stop offset=".55" stop-color="#ec4899"/><stop offset=".8" stop-color="#f97316"/>' +
  '<stop offset="1" stop-color="#eab308"/></linearGradient></defs>';

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${RAINBOW}${body}</svg>`;
const face = (fill, inner) => `<circle cx="32" cy="33" r="27" fill="${fill}" stroke="#00000033" stroke-width="2"/>${inner}`;
const letter = (txt, size, fill) =>
  `<text x="32" y="${size > 30 ? 45 : 42}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="900" font-size="${size}" fill="${fill}">${txt}</text>`;

const BUILTIN = {
  AterW: svg('<rect x="4" y="8" width="56" height="48" rx="14" fill="url(#r)"/>' + letter('W', 34, '#fff')),
  AterL: svg('<rect x="4" y="8" width="56" height="48" rx="14" fill="#2a2a2e" stroke="#ff5a52" stroke-width="3"/>' + letter('L', 34, '#ff5a52')),
  AterGG: svg('<rect x="2" y="12" width="60" height="40" rx="12" fill="#0b0b0c" stroke="url(#r)" stroke-width="4"/>' + letter('GG', 24, '#fff')),
  AterPog: svg(face('#f5c84c',
    '<circle cx="22" cy="26" r="7" fill="#fff"/><circle cx="42" cy="26" r="7" fill="#fff"/>' +
    '<circle cx="22" cy="27" r="3.5" fill="#1a1204"/><circle cx="42" cy="27" r="3.5" fill="#1a1204"/>' +
    '<ellipse cx="32" cy="45" rx="7" ry="9" fill="#5b1d0e"/>')),
  AterLUL: svg(face('#f5c84c',
    '<path d="M15 26q6-7 12 0M37 26q6-7 12 0" stroke="#1a1204" stroke-width="3.5" fill="none" stroke-linecap="round"/>' +
    '<path d="M15 36q17 22 34 0z" fill="#5b1d0e"/><path d="M19 37q13 6 26 0" fill="#fff"/>' +
    '<path d="M10 30q-4 8 0 12M54 30q4 8 0 12" stroke="#7ad3ff" stroke-width="4" fill="none" stroke-linecap="round"/>')),
  AterSadge: svg(face('#8fa8ff',
    '<path d="M16 24l10 4M48 24l-10 4" stroke="#14183a" stroke-width="3.5" stroke-linecap="round"/>' +
    '<circle cx="22" cy="32" r="3" fill="#14183a"/><circle cx="42" cy="32" r="3" fill="#14183a"/>' +
    '<path d="M24 48q8-6 16 0" stroke="#14183a" stroke-width="3.5" fill="none" stroke-linecap="round"/>' +
    '<path d="M45 37q3 6 0 9q-3-3 0-9z" fill="#e6f7ff"/>')),
  AterCope: svg(face('#f5c84c',
    '<circle cx="22" cy="29" r="3.5" fill="#1a1204"/><circle cx="42" cy="29" r="3.5" fill="#1a1204"/>' +
    '<path d="M22 45h20" stroke="#1a1204" stroke-width="3.5" stroke-linecap="round"/>' +
    '<path d="M50 12q5 8 0 12q-5-4 0-12z" fill="#7ad3ff"/>')),
  AterHmm: svg(face('#f5c84c',
    '<path d="M15 22l11-3M38 24h11" stroke="#1a1204" stroke-width="3.5" stroke-linecap="round"/>' +
    '<circle cx="22" cy="30" r="3.5" fill="#1a1204"/><circle cx="43" cy="31" r="3.5" fill="#1a1204"/>' +
    '<path d="M26 46q6-3 12 1" stroke="#1a1204" stroke-width="3.5" fill="none" stroke-linecap="round"/>' +
    '<path d="M40 60q-6-10 4-14l8-2q4 1 2 5l-6 3" fill="#e9b23a" stroke="#00000033" stroke-width="2"/>')),
  AterHype: svg(
    '<path d="M32 4c4 10 18 16 18 32a18 18 0 0 1-36 0c0-8 4-13 8-16 0 6 3 9 6 9-3-9 0-19 4-25z" fill="url(#r)"/>' +
    '<path d="M32 30c3 5 9 8 9 15a9 9 0 0 1-18 0c0-5 5-8 9-15z" fill="#fff" opacity=".85"/>'),
  AterLove: svg(
    '<path d="M32 56S6 40 6 22A13 13 0 0 1 32 15a13 13 0 0 1 26 7c0 18-26 34-26 34z" fill="url(#r)"/>' +
    '<path d="M18 20a7 7 0 0 1 8-3" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/>'),
};

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{1,23}$/;
const UPLOAD_RE = /^data:(image\/(?:png|gif|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_BYTES = 300_000;

/** Every emote, built-in first, as { name, url } for clients. */
function emoteList(db) {
  const out = Object.keys(BUILTIN).map((name) => ({ name, url: '/api/emote/' + name, b: 1 }));
  for (const [name, e] of Object.entries(db.emotes)) out.push({ name, url: `/api/emote/${name}?v=${e.ts}`, by: e.by });
  return out;
}

/** Check an upload. Returns { error } or { type, data }. SVG uploads are refused on purpose. */
function checkUpload(db, name, dataUrl) {
  if (!NAME_RE.test(name)) return { error: 'Emote names: 2 to 24 letters, numbers or _, starting with a letter.' };
  if (BUILTIN[name] || db.emotes[name]) return { error: 'There is already an emote called ' + name + '.' };
  const m = String(dataUrl || '').match(UPLOAD_RE);
  if (!m) return { error: 'PNG, GIF or WebP only.' };
  if ((m[2].length * 3) / 4 > MAX_BYTES) return { error: 'Keep emotes under 300 KB.' };
  return { type: m[1], data: m[2] };
}

const isEmote = (db, word) => Boolean(BUILTIN[word] || db.emotes[word]);

module.exports = { BUILTIN, emoteList, checkUpload, isEmote };
