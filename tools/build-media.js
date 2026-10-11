// ── BLACK BRIEF: MEDIA MARKS (test page only) ──
// GitHub runs this by itself each time posts.txt changes (see
// .github/workflows/media-marks.yml). For each X post in posts.txt it finds
// out whether the post carries an image or a video, and writes the answers to
// tools/media-cache.json. Only test.html reads that file: it turns a card's
// "view post" into "view video" or "view image".
//
// Nothing here touches posts.txt, the share pages or the live site. To remove
// the experiment, delete this file, tools/media-cache.json and
// .github/workflows/media-marks.yml.
//
// Two lookups, in this order:
//   1. X's embed data service. It says exactly what a post holds, but it is
//      not an official service and X could change or close it at any time.
//   2. X's official oEmbed service (the one the share pages already use). It
//      can only say that a post has "some media", not which kind.
// If the first one stops working the marks fall back to "view media".
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'media-cache.json');
const MAX_TRIES = 3; // per post, across runs, before giving up

// ── the same rules index.html uses to read a posts.txt line ──
const TS_RE = /(?:^|\s)@(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)(?=\s|$)/;
function stripTags(l) { return l.replace(/\s+#\w+/g, '').trim(); }
function safeUrl(r) {
  try {
    const u = new URL(r);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.href;
  } catch (e) { return null; }
}
function urlPart(line) {
  const i = line.indexOf(' | ');
  return i === -1 ? line : line.substring(0, i).trim();
}
function ytId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('?')[0];
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v') || u.pathname.split('/').pop();
  } catch (e) {}
  return null;
}
function isTw(url) { return url.includes('twitter.com') || url.includes('x.com'); }

// MUST stay identical to bbCode() in index.html
function bbCode(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

// → { id, clean, sid } for an X post line, or null for anything else
function tweetOf(raw) {
  if (raw.length <= 8) return null;
  const m = raw.match(TS_RE);
  const text = m ? raw.replace(TS_RE, ' ').replace(/\s+/g, ' ').trim() : raw;
  if (text.trimStart().charAt(0) === '§') return null;
  const url = safeUrl(stripTags(urlPart(text)));
  if (!url || ytId(url) || !isTw(url)) return null;
  const clean = url.replace('x.com', 'twitter.com').split('?')[0];
  const sid = (clean.match(/status\/(\d+)/) || [])[1] || '';
  return { id: url, clean, sid };
}

const strikes = {}; // a service that fails 4 times in a row is left alone for the rest of the run
async function get(host, url) {
  if ((strikes[host] || 0) >= 4) return undefined;
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; blackbrief-media/1.0; +https://theblackbrief.com)' }
    });
    if (r.status === 404 || r.status === 403) { strikes[host] = 0; return { gone: true }; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    strikes[host] = 0;
    return { json: j };
  } catch (e) {
    strikes[host] = (strikes[host] || 0) + 1;
    return null;
  }
}

// 1. X's embed data service → 'video' | 'image' | '' , or null if it gave no usable answer
async function fromEmbedData(sid) {
  if (!sid) return null;
  const token = ((Number(sid) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
  const r = await get('embed', 'https://cdn.syndication.twimg.com/tweet-result?id=' + sid + '&token=' + token + '&lang=en');
  if (!r || !r.json) return null; // failed, skipped or "not found": let oEmbed decide
  const j = r.json;
  if (!j || !j.id_str || (j.__typename && j.__typename !== 'Tweet')) return null;
  const kinds = (Array.isArray(j.mediaDetails) ? j.mediaDetails : []).map(d => d && d.type);
  if (j.video || kinds.includes('video') || kinds.includes('animated_gif')) return 'video';
  if (kinds.includes('photo') || (Array.isArray(j.photos) && j.photos.length)) return 'image';
  return '';
}

// 2. official oEmbed → 'media' | '' , or null if it gave no usable answer
async function fromOembed(clean) {
  const r = await get('oembed', 'https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=' + encodeURIComponent(clean));
  if (!r) return null;
  if (r.gone) return ''; // deleted or private: nothing to mark
  return /pic\.twitter\.com\//.test(String((r.json && r.json.html) || '')) ? 'media' : '';
}

(async function main() {
  const lines = fs.readFileSync(path.join(ROOT, 'posts.txt'), 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(OUT, 'utf8')) || {}; } catch (e) {}

  const next = {};
  const count = { video: 0, image: 0, media: 0, none: 0, waiting: 0 };
  let looked = 0, exact = 0;
  for (const l of lines) {
    const t = tweetOf(l);
    if (!t) continue;
    const code = bbCode(t.id);
    if (next[code]) continue;
    let e = cache[code] || { m: '', done: false, tries: 0 };
    if (!e.done && (e.tries || 0) < MAX_TRIES) {
      looked++;
      let m = await fromEmbedData(t.sid);
      let by = 'embed';
      if (m === null) { m = await fromOembed(t.clean); by = 'oembed'; }
      if (m === null) e = { m: '', done: false, tries: (e.tries || 0) + 1 };
      else { e = { m, done: true, by }; if (by === 'embed') exact++; }
      await new Promise(r => setTimeout(r, 120));
    }
    next[code] = e;
    if (!e.done) count.waiting++; else count[e.m || 'none']++;
  }

  fs.writeFileSync(OUT, JSON.stringify(next, null, 1) + '\n');
  console.log(Object.keys(next).length + ' X posts: ' + count.video + ' video, ' + count.image + ' image, ' + count.media + ' media (kind unknown), ' + count.none + ' none, ' + count.waiting + ' not answered yet');
  console.log(looked + ' looked up this run; ' + exact + ' answered by the embed data service');
  for (const h of Object.keys(strikes)) if (strikes[h] >= 4) console.log('note: the "' + h + '" lookups were failing, so the rest were skipped this run');
})().catch(e => { console.error(e); process.exit(1); });
