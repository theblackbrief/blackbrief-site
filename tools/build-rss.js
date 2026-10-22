// ── BLACK BRIEF: RSS FEED BUILDER ──
// GitHub runs this by itself (see .github/workflows/rss.yml) right after
// "housekeeping and share pages" finishes, so it always sees the trimmed
// posts.txt and the newest X wording in tools/share-cache.json.
// It writes rss.xml at the top of the repo:  theblackbrief.com/rss.xml
//
// Each post becomes one item. The item's link is the post's short share link
// (theblackbrief.com/p/<code>/), so readers land on the site, with the post
// highlighted, not on X. The original source is linked inside the item.
// Nothing here changes index.html, posts.txt or share-cache.json.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'rss.xml');
const CACHE_FILE = path.join(__dirname, 'share-cache.json');
const SITE = 'https://theblackbrief.com';
const NAME = 'the / black brief';
const TAGLINE = "a newsfeed of things we don't wanna see in a world that isn't supposed to be";
const MAX_ITEMS = 100; // housekeeping keeps 50 to 100 posts, so this is all of them

// ── the same rules index.html uses to read a posts.txt line ──
const TS_RE = /(?:^|\s)@(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)(?=\s|$)/;
function stripTags(l) { return l.replace(/\s+#\w+/g, '').trim(); }
function tagOf(l) { const m = l.match(/\s#(\w+)/); return m ? m[1].toLowerCase() : ''; }
function safeUrl(r) {
  try {
    const u = new URL(r);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.href;
  } catch (e) { return null; }
}
function splitLabel(line) {
  const i = line.indexOf(' | ');
  if (i === -1) return { urlPart: line, label: '' };
  return { urlPart: line.substring(0, i).trim(), label: line.substring(i + 3).replace(/\s+#\w+/g, '').trim() };
}
function domain(url) { try { return new URL(url).hostname.replace('www.', ''); } catch (e) { return ''; } }
function ytId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('?')[0];
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v') || u.pathname.split('/').pop();
  } catch (e) {}
  return null;
}
function isTw(url) { return url.includes('twitter.com') || url.includes('x.com'); }
function handleOf(url) {
  try { const seg = new URL(url).pathname.split('/')[1]; return seg && seg !== 'i' ? '@' + seg : ''; } catch (e) { return ''; }
}

// MUST stay identical to bbCode() in index.html and tools/build-share.js
function bbCode(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

function parse(raw) {
  const m = raw.match(TS_RE);
  const ts = m ? Date.parse(m[1]) : NaN;
  const text = m ? raw.replace(TS_RE, ' ').replace(/\s+/g, ' ').trim() : raw;
  const tag = tagOf(' ' + text);
  if (text.trimStart().charAt(0) === '§') {
    const id = text.replace(/\s+#\w+/g, '').trim();
    return { kind: 'editorial', id, text: id.replace(/^§\s*/, '').trim(), ts, tag };
  }
  const parts = splitLabel(text);
  const url = safeUrl(stripTags(parts.urlPart));
  if (!url) return null;
  const kind = ytId(url) ? 'video' : isTw(url) ? 'tweet' : 'article';
  return { kind, id: url, url, label: parts.label, ts, tag };
}

// ── small helpers ──
function clip(s, n) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }
// XML-safe text: escape, and drop characters XML does not allow
function x(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// what each item says
function describe(post, c) {
  const f = c || {};
  if (post.kind === 'editorial') {
    return { title: clip(post.text, 160), body: post.text, source: '', sourceName: '' };
  }
  if (post.kind === 'tweet') {
    const h = handleOf(post.url);
    const full = f.title || ''; // "@Handle: the post's wording", from build-share.js
    return {
      title: clip(full || ((h || 'a post') + ' on X'), 160),
      body: full,
      source: post.url,
      sourceName: 'view post on x'
    };
  }
  if (post.kind === 'video') {
    return { title: clip(f.title || 'video // youtube.com', 160), body: f.title || '', source: post.url, sourceName: 'watch on youtube' };
  }
  const d = domain(post.url);
  const t = post.label || f.title || d;
  return { title: clip(t, 160), body: t, source: post.url, sourceName: 'read on ' + d };
}

function itemXml(p) {
  const { post, code, ts, cache } = p;
  const link = SITE + '/p/' + code + '/';
  const d = describe(post, cache);
  const desk = cache && cache.desk ? String(cache.desk).replace(/^\//, '') : '';
  const tag = post.tag && post.tag !== 'headline' ? post.tag : '';

  // the item's text (shown by feed readers): wording, then the links
  let html = '';
  if (d.body) html += '<p>' + x(d.body) + '</p>';
  if (post.kind === 'video' && cache && cache.image) html += '<p><img src="' + x(cache.image) + '" alt=""/></p>';
  const bits = [];
  if (desk) bits.push('/' + x(desk));
  if (tag) bits.push('#' + x(tag));
  const links = [];
  if (d.source) links.push('<a href="' + x(d.source) + '">' + x(d.sourceName) + ' »</a>');
  links.push('<a href="' + x(link) + '">open on ' + x(NAME) + ' »</a>');
  html += '<p>' + (bits.length ? bits.join(' // ') + ' // ' : '') + links.join(' &#160; ') + '</p>';

  let out = '  <item>\n';
  out += '   <title>' + x(d.title) + '</title>\n';
  out += '   <link>' + x(link) + '</link>\n';
  out += '   <guid isPermaLink="true">' + x(link) + '</guid>\n';
  if (ts) out += '   <pubDate>' + new Date(ts).toUTCString() + '</pubDate>\n';
  if (desk) out += '   <category>' + x(desk) + '</category>\n';
  if (tag) out += '   <category>' + x(tag) + '</category>\n';
  out += '   <description>' + x(html) + '</description>\n';
  out += '  </item>\n';
  return out;
}

(function main() {
  const now = Date.now();
  const raw = fs.readFileSync(path.join(ROOT, 'posts.txt'), 'utf8');
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 8); // oldest first
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {}; } catch (e) {}

  // a line with no date takes the date of the dated post before it in the
  // file (the same rule housekeeping uses)
  let lastTs = 0;
  const rows = [];
  for (const l of lines) {
    const p = parse(l);
    if (!p || !p.id) continue;
    let ts = p.ts;
    if (!isNaN(ts)) { ts = Math.min(ts, now); lastTs = ts; } else ts = lastTs;
    rows.push({ post: p, ts });
  }
  rows.reverse(); // newest first

  const seen = {}, items = [];
  for (const r of rows) {
    const code = bbCode(r.post.id);
    if (seen[code]) continue; // same post twice: keep the newer one
    seen[code] = true;
    items.push({ post: r.post, code, ts: r.ts, cache: cache[code] });
    if (items.length >= MAX_ITEMS) break;
  }

  // "last updated" = the newest post, so the file only changes when the feed does
  const newest = items.reduce((m, i) => Math.max(m, i.ts || 0), 0);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
  xml += ' <channel>\n';
  xml += '  <title>' + x(NAME) + '</title>\n';
  xml += '  <link>' + SITE + '/</link>\n';
  xml += '  <description>' + x(TAGLINE) + '</description>\n';
  xml += '  <language>en</language>\n';
  xml += '  <atom:link href="' + SITE + '/rss.xml" rel="self" type="application/rss+xml"/>\n';
  if (newest) xml += '  <lastBuildDate>' + new Date(newest).toUTCString() + '</lastBuildDate>\n';
  xml += '  <ttl>15</ttl>\n';
  xml += '  <image>\n   <url>' + SITE + '/BB_Icon.png</url>\n   <title>' + x(NAME) + '</title>\n   <link>' + SITE + '/</link>\n  </image>\n';
  for (const i of items) xml += itemXml(i);
  xml += ' </channel>\n</rss>\n';

  let old = '';
  try { old = fs.readFileSync(OUT_FILE, 'utf8'); } catch (e) {}
  if (old === xml) { console.log('rss.xml unchanged (' + items.length + ' items)'); return; }
  fs.writeFileSync(OUT_FILE, xml);
  const worded = items.filter(i => i.post.kind !== 'tweet' || (i.cache && i.cache.title)).length;
  console.log('rss.xml written: ' + items.length + ' items, ' + worded + ' with full wording');
})();
