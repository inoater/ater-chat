'use strict';
/*
 * Uploaded images: profile pictures, role badges and emotes.
 *
 * The browser resizes and compresses images before they're sent (see
 * public/js/app.js, fitImage). The server still checks every upload: it
 * reads the real type and pixel size from the file's own header, never
 * trusting the name or the data: URL label, and refuses anything too big.
 * SVG is never accepted (it can carry scripts).
 */
const KINDS = {
  avatar: { maxW: 256, maxH: 256, bytes: 250_000, label: 'Profile pictures' },
  badge: { maxW: 128, maxH: 128, bytes: 120_000, label: 'Role badges' },
  emote: { maxW: 512, maxH: 128, bytes: 300_000, label: 'Emotes' },
};
const MIME = { png: 'image/png', gif: 'image/gif', webp: 'image/webp', jpeg: 'image/jpeg' };

/** Type and size from the first bytes of a PNG, GIF, WebP or JPEG. */
function imageInfo(b) {
  if (!Buffer.isBuffer(b) || b.length < 24) return null;
  if (b.readUInt32BE(0) === 0x89504e47) return { type: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.toString('ascii', 0, 4) === 'GIF8') return { type: 'gif', w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const f = b.toString('ascii', 12, 16);
    if (f === 'VP8X' && b.length >= 30) return { type: 'webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (f === 'VP8 ' && b.length >= 30) return { type: 'webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (f === 'VP8L' && b.length >= 25) { const v = b.readUInt32LE(21); return { type: 'webp', w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'jpeg', w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/** Check a data: URL for a kind of upload. Returns { error } or { type, data, w, h, bytes }. */
function checkImage(kind, dataUrl) {
  const k = KINDS[kind];
  const m = String(dataUrl || '').match(/^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/);
  if (!k || !m) return { error: 'Use a PNG, GIF, WebP or JPEG image.' };
  const buf = Buffer.from(m[1], 'base64');
  const info = imageInfo(buf);
  if (!info) return { error: 'That doesn’t look like a PNG, GIF, WebP or JPEG.' };
  if (buf.length > k.bytes) return { error: `${k.label} must be under ${Math.round(k.bytes / 1000)} KB after resizing.` };
  if (info.w > k.maxW || info.h > k.maxH || !info.w || !info.h) return { error: `${k.label} can be at most ${k.maxW}×${k.maxH} pixels.` };
  return { type: MIME[info.type], data: m[1], w: info.w, h: info.h, bytes: buf.length };
}

module.exports = { imageInfo, checkImage, KINDS };
