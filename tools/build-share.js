// ── BLACK BRIEF: SHARE PAGE BUILDER ──
// GitHub runs this by itself every time posts.txt changes (see
// .github/workflows/share-pages.yml). For each post it writes a tiny page at
//   /p/<code>/index.html
// holding that post's own preview title and description, which then sends the
// visitor on to the post on the main site. Nothing here changes index.html.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'p');
const CACHE_FILE = path.join(__dirname, 'share-cache.json');
const SITE = 'https://theblackbrief.com';
const NAME = 'the / black brief';
const TAGLINE = "a newsfeed of things we don't wanna see in a world that isn't supposed to be";
const IMAGE = SITE + '/BB_Share_Image.png';
const MAX_TRIES = 3; // per post, across runs, before giving up on a lookup

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

// MUST stay identical to bbCode() in index.html
function bbCode(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

function parse(raw) {
  const m = raw.match(TS_RE);
  const text = m ? raw.replace(TS_RE, ' ').replace(/\s+/g, ' ').trim() : raw;
  if (text.trimStart().charAt(0) === '§') {
    const id = text.replace(/\s+#\w+/g, '').trim();
    return { kind: 'editorial', id, text: id.replace(/^§\s*/, '').trim() };
  }
  const parts = splitLabel(text);
  const url = safeUrl(stripTags(parts.urlPart));
  if (!url) return null;
  const kind = ytId(url) ? 'video' : isTw(url) ? 'tweet' : 'article';
  return { kind, id: url, url, label: parts.label };
}

// ── small helpers ──
function clip(s, n) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function decode(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function tweetText(html) {
  const m = String(html || '').match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (!m) return '';
  return decode(m[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s*pic\.twitter\.com\/\S+/g, '').replace(/\s*https?:\/\/t\.co\/\S+/g, '')
    .replace(/\s+/g, ' ').trim();
}
function handleOf(url) {
  try { const seg = new URL(url).pathname.split('/')[1]; return seg && seg !== 'i' ? '@' + seg : ''; } catch (e) { return ''; }
}

// ── lookups (each post is looked up once, then remembered in share-cache.json) ──
const strikes = {}; // if a service fails 4 times in a row, stop asking it this run
async function getJson(host, url) {
  if ((strikes[host] || 0) >= 4) return undefined; // skipped, not attempted
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; blackbrief-share/1.0; +' + SITE + ')' }
    });
    if (r.status === 404 || r.status === 403) { strikes[host] = 0; return { gone: true }; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    strikes[host] = 0;
    return j;
  } catch (e) {
    strikes[host] = (strikes[host] || 0) + 1;
    return null;
  }
}

async function lookup(post) {
  if (post.kind === 'tweet') {
    const clean = post.url.replace('x.com', 'twitter.com').split('?')[0];
    const j = await getJson('x', 'https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=' + encodeURIComponent(clean));
    if (!j || j.gone) return j;
    const text = tweetText(j.html);
    const h = j.author_url ? '@' + String(j.author_url).split('/').pop() : handleOf(post.url);
    return { title: text ? (h ? h + ': ' : '') + text : '' };
  }
  if (post.kind === 'video') {
    const j = await getJson('yt', 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(post.url));
    if (!j || j.gone) return j;
    return { title: j.title || '', image: j.thumbnail_url || '' };
  }
  if (post.kind === 'article' && !post.label) {
    const j = await getJson('ml', 'https://api.microlink.io?url=' + encodeURIComponent(post.url));
    if (!j || j.gone) return j;
    return { title: (j.status === 'success' && j.data && j.data.title) || '' };
  }
  return { title: '' };
}

function card(post, found) {
  const f = found || {};
  if (post.kind === 'editorial') return { title: clip(post.text, 160), desc: 'blackbrief § editorial', image: IMAGE };
  const d = domain(post.url);
  if (post.kind === 'tweet') {
    return { title: clip(f.title || ((handleOf(post.url) || 'a post') + ' on X'), 200), desc: 'via ' + NAME + ' — ' + TAGLINE, image: IMAGE };
  }
  if (post.kind === 'video') {
    return { title: clip(f.title || 'video // youtube.com', 160), desc: 'video // via ' + NAME, image: f.image || IMAGE };
  }
  return { title: clip(post.label || f.title || d, 160), desc: d + ' // via ' + NAME, image: IMAGE };
}

function page(code, post, c) {
  const dest = '/?post=' + encodeURIComponent(post.id);
  const self = SITE + '/p/' + code + '/';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(c.title)} // ${NAME}</title>
<meta name="description" content="${esc(c.desc)}"/>
<meta name="robots" content="noindex"/>
<link rel="icon" type="image/png" href="/BB_Icon.png"/>
<meta property="og:type" content="article"/>
<meta property="og:site_name" content="${NAME}"/>
<meta property="og:url" content="${self}"/>
<meta property="og:title" content="${esc(c.title)}"/>
<meta property="og:description" content="${esc(c.desc)}"/>
<meta property="og:image" content="${esc(c.image)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(c.title)}"/>
<meta name="twitter:description" content="${esc(c.desc)}"/>
<meta name="twitter:image" content="${esc(c.image)}"/>
<script>location.replace(${JSON.stringify(dest)});</script>
<style>html,body{background:#000;color:#888;font-family:serif;text-align:center;padding:40px 20px}a{color:#cc2222}</style>
</head>
<body>
<p>${esc(c.title)}</p>
<p><a href="${esc(dest)}">open on ${NAME} »</a></p>
</body>
</html>
`;
}

(async function main() {
  const raw = fs.readFileSync(path.join(ROOT, 'posts.txt'), 'utf8');
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 8).reverse(); // newest first
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) {}

  const seen = {}, posts = [];
  for (const l of lines) {
    const p = parse(l);
    if (!p || !p.id) continue;
    const code = bbCode(p.id);
    if (seen[code]) { if (seen[code] !== p.id) console.log('code clash, kept the newer post:', code); continue; }
    seen[code] = p.id;
    posts.push({ code, post: p });
  }

  let looked = 0, got = 0;
  const next = {};
  for (const { code, post } of posts) {
    let entry = cache[code] || { tries: 0, done: false };
    const needs = post.kind === 'tweet' || post.kind === 'video' || (post.kind === 'article' && !post.label);
    if (needs && !entry.done && entry.tries < MAX_TRIES) {
      const f = await lookup(post);
      if (f !== undefined) { // undefined = service skipped this run; try again next time
        looked++;
        if (f && f.gone) entry = { tries: entry.tries + 1, done: true };
        else if (f) { entry = { tries: entry.tries + 1, done: true, title: f.title || '', image: f.image || '' }; if (f.title) got++; }
        else entry = { tries: entry.tries + 1, done: false };
        await new Promise(r => setTimeout(r, 120));
      }
    }
    next[code] = entry;
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  for (const { code, post } of posts) {
    const dir = path.join(OUT, code);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), page(code, post, card(post, next[code])));
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(next, null, 1) + '\n');
  console.log(posts.length + ' share pages written; ' + looked + ' lookups this run, ' + got + ' returned a title');
  for (const h of Object.keys(strikes)) if (strikes[h] >= 4) console.log('note: lookups for "' + h + '" were failing, so the rest were skipped this run');
})().catch(e => { console.error(e); process.exit(1); });
