// ── BLACK BRIEF: SHARE PAGE BUILDER ──
// GitHub runs this by itself every time posts.txt changes (see
// .github/workflows/share-pages.yml). For each post it writes a tiny page at
//   /p/<code>/index.html
// holding that post's own preview title and description, which then sends the
// visitor on to the post on the main site. Nothing here changes index.html.
//
// It also keeps tools/share-cache.json, which the main site reads to draw its
// X cards (Oct 2026): for each X post, its wording ("title") and whether it
// carries a video or an image ("media"). Since the DESKS step it also files
// every post under a subject desk ("desk"; see DESKS below).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'p');
const CACHE_FILE = path.join(__dirname, 'share-cache.json');
const DESK_REPORT = path.join(__dirname, 'desk-report.json');
const SITE = 'https://theblackbrief.com';
const NAME = 'the / black brief';
const TAGLINE = "a newsfeed of things we don't wanna see in a world that isn't supposed to be";
const IMAGE = SITE + '/BB_Share_Image.png';
const MAX_TRIES = 3; // per post, across runs, before giving up on a lookup

// ── DESKS (Oct 2026) ──
// Every post is filed under ONE subject desk, shown in the ticker as
// [ 12 /money ] and tappable to filter the feed. Filing is redone on every
// run, so a change below refiles the whole feed within a minute or two.
//   1. The source account decides first (X posts only). Handles are written
//      lowercase, without the @.
//   2. Otherwise the wording is searched for the words below; the desk with
//      the most matches wins (a tie goes to the desk listed first).
//   3. Otherwise the post stays unfiled and shows under no desk.
// Editorials are never filed: they are the curator's own voice.
// tools/desk-report.json lists the counts and the X accounts still unfiled,
// so they can be added here.
const DESKS = ['war', 'power', 'money', 'tech', 'anomaly'];
const DESK_ACCOUNTS = {
  war: ['shaykhsulaiman', 'hormuzletter', 'visegrad24', 'bricsinfo', 'warsurv', 'geopolitics_emp',
    'az_intel_', 'persianserene1', 'doctor_rahmeh', 'generalmcnews'],
  power: ['whitehouse', 'presssec', 'libsoftiktok', 'anncoulter', 'theblaze', 'emeraldrobinson',
    'nataliegwinters', 'moreperfectus', 'swamp__watch', 'amoneyresists', 'owenshroyer1776',
    'theintercept', 'imbreckworsham', 'keithwoodsyt', 'juliecbarrett'],
  money: ['kobeissiletter', 'zerohedge', 'polymarket', 'kalshi', 'unusual_whales', 'barchart',
    'wallstreetapes', 'wallstreetmav', 'charliebilello', 'firstsquawk', 'cryptorover', 'bulltheoryio',
    'greybtc', 'financelancelot', 'geiger_capital', 'stealthqe4', 'mrbankstips', 'hedgeye', 'famexbt',
    'gemini', 'watcherguru', 'jameslavish'],
  tech: ['xfreeze', 'trungtphan'],
  anomaly: ['cdcgov']
};
const DESK_WORDS = {
  war: ['war', 'wars', 'warfare', 'military', 'troops', 'soldier', 'soldiers', 'army', 'navy', 'air force',
    'pentagon', 'missile', 'missiles', 'drone', 'drones', 'airstrike', 'airstrikes', 'strikes', 'bomb',
    'bombs', 'bombing', 'bomber', 'bombers', 'invasion', 'invade', 'ceasefire', 'nato', 'nuclear', 'iran',
    'iranian', 'tehran', 'israel', 'israeli', 'idf', 'gaza', 'hamas', 'hezbollah', 'houthi', 'houthis',
    'lebanon', 'syria', 'yemen', 'ukraine', 'ukrainian', 'russia', 'russian', 'kremlin', 'putin',
    'zelensky', 'taiwan', 'hormuz', 'strait', 'irgc', 'tanker', 'tankers', 'warship', 'warships',
    'weapons', 'hostage', 'hostages'],
  power: ['trump', 'biden', 'harris', 'obama', 'vance', 'rubio', 'white house', 'congress', 'senate',
    'senator', 'house speaker', 'democrat', 'democrats', 'democratic', 'republican', 'republicans', 'gop',
    'maga', 'election', 'elections', 'ballot', 'vote', 'voters', 'supreme court', 'scotus', 'doj', 'fbi',
    'attorney general', 'governor', 'mayor', 'president', 'administration', 'impeach', 'impeachment',
    'epstein', 'immigration', 'deport', 'deportation', 'deportations', 'border', 'shutdown',
    'executive order', 'lawmaker', 'lawmakers', 'newsom', 'press secretary', 'leavitt'],
  money: ['market', 'markets', 'stock', 'stocks', 's&p', 'nasdaq', 'dow', 'wall street', 'fed',
    'federal reserve', 'powell', 'rate cut', 'rate cuts', 'interest rate', 'interest rates', 'inflation',
    'cpi', 'jobs report', 'unemployment', 'recession', 'gdp', 'economy', 'economic', 'treasury', 'yield',
    'yields', 'bond', 'bonds', 'oil', 'gold', 'silver', 'bitcoin', 'btc', 'crypto', 'ethereum', 'dollar',
    'tariff', 'tariffs', 'earnings', 'bank', 'banks', 'debt', 'polymarket', 'kalshi', 'odds',
    'prediction market', 'billion', 'trillion', 'price', 'prices', 'housing', 'mortgage', 'ipo', 'shares'],
  tech: ['ai', 'a.i.', 'artificial intelligence', 'openai', 'chatgpt', 'nvidia', 'apple', 'iphone',
    'google', 'meta', 'microsoft', 'tesla', 'spacex', 'starlink', 'xai', 'grok', 'robot', 'robots',
    'robotics', 'chip', 'chips', 'semiconductor', 'semiconductors', 'hack', 'hacked', 'hacker', 'hackers',
    'cyber', 'cyberattack', 'surveillance', 'facial recognition', 'data breach', 'deepfake', 'quantum',
    'algorithm', 'smartphone', 'software'],
  anomaly: ['ufo', 'ufos', 'uap', 'uaps', 'alien', 'aliens', 'extraterrestrial', 'earthquake', 'earthquakes',
    'quake', 'quakes', 'volcano', 'eruption', 'tsunami', 'outbreak', 'virus', 'pandemic', 'measles',
    'bird flu', 'h5n1', 'cdc', 'mysterious', 'mystery', 'unexplained', 'missing', 'sinkhole', 'meteor',
    'asteroid', 'solar flare', 'strange', 'bizarre', 'anomaly', 'fireball', 'sighting', 'disappeared']
};

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

// ── DESK FILING ──
const deskAccount = {};
for (const d of DESKS) for (const h of DESK_ACCOUNTS[d] || []) deskAccount[h.toLowerCase()] = d;
function wordRe(w) { return new RegExp('(?<![a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])'); }
const deskRes = DESKS.map(d => ({ d, res: (DESK_WORDS[d] || []).map(wordRe) }));
// → { desk: 'money' | '' , by: 'account' | 'words' | '' }
function deskOf(post, entry) {
  if (post.kind === 'editorial') return { desk: '', by: '' };
  if (post.kind === 'tweet') {
    const h = handleOf(post.url).slice(1).toLowerCase();
    if (deskAccount[h]) return { desk: deskAccount[h], by: 'account' };
  }
  let text = post.label || (entry && entry.title) || '';
  if (post.kind === 'tweet' && !post.label) { const i = text.indexOf(': '); if (text.charAt(0) === '@' && i !== -1) text = text.slice(i + 2); }
  text = String(text).toLowerCase();
  if (!text) return { desk: '', by: '' };
  let best = '', top = 0;
  for (const { d, res } of deskRes) {
    let n = 0;
    for (const re of res) if (re.test(text)) n++;
    if (n > top) { top = n; best = d; }
  }
  return { desk: best, by: best ? 'words' : '' };
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

function oembedUrl(post) {
  const clean = post.url.replace('x.com', 'twitter.com').split('?')[0];
  return 'https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=' + encodeURIComponent(clean);
}

async function lookup(post) {
  if (post.kind === 'tweet') {
    const j = await getJson('x', oembedUrl(post));
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

// ── MEDIA MARKS (Oct 2026) ──
// Does an X post carry a video or an image? The card on the main site then
// reads "view video »" or "view image »" instead of "view post »".
// Two lookups, in this order:
//   1. X's embed data service. It says exactly what a post holds, but it is
//      not an official service and X could change or close it at any time.
//   2. X's official oEmbed service (the one used for the wording above). It
//      can only say that a post has "some media", not which kind.
// → 'video' | 'image' | 'media' (kind unknown) | '' (none), null if neither
//   service gave an answer, undefined if both were skipped this run.
async function mediaOf(post) {
  const sid = (post.url.match(/status\/(\d+)/) || [])[1];
  if (sid) {
    const token = ((Number(sid) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    const j = await getJson('embed', 'https://cdn.syndication.twimg.com/tweet-result?id=' + sid + '&token=' + token + '&lang=en');
    if (j && !j.gone && j.id_str && (!j.__typename || j.__typename === 'Tweet')) {
      const kinds = (Array.isArray(j.mediaDetails) ? j.mediaDetails : []).map(d => d && d.type);
      if (j.video || kinds.includes('video') || kinds.includes('animated_gif')) return 'video';
      if (kinds.includes('photo') || (Array.isArray(j.photos) && j.photos.length)) return 'image';
      return '';
    }
  }
  const o = await getJson('x', oembedUrl(post));
  if (o === undefined || o === null) return o;
  if (o.gone) return ''; // deleted or private: nothing to mark
  return /pic\.twitter\.com\//.test(String(o.html || '')) ? 'media' : '';
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

  let looked = 0, got = 0, marked = 0;
  const next = {};
  for (const { code, post } of posts) {
    let entry = cache[code] || { tries: 0, done: false };
    const needs = post.kind === 'tweet' || post.kind === 'video' || (post.kind === 'article' && !post.label);
    if (needs && !entry.done && entry.tries < MAX_TRIES) {
      const f = await lookup(post);
      if (f !== undefined) { // undefined = service skipped this run; try again next time
        looked++;
        const keep = { media: entry.media, mtries: entry.mtries };
        if (f && f.gone) entry = { tries: entry.tries + 1, done: true };
        else if (f) { entry = { tries: entry.tries + 1, done: true, title: f.title || '', image: f.image || '' }; if (f.title) got++; }
        else entry = { tries: entry.tries + 1, done: false };
        if (keep.media !== undefined) entry.media = keep.media;
        if (keep.mtries !== undefined) entry.mtries = keep.mtries;
        await new Promise(r => setTimeout(r, 120));
      }
    }
    if (post.kind === 'tweet' && entry.media === undefined && (entry.mtries || 0) < MAX_TRIES) {
      const m = await mediaOf(post);
      if (m === null) entry.mtries = (entry.mtries || 0) + 1;
      else if (m !== undefined) { entry.media = m; delete entry.mtries; marked++; }
      await new Promise(r => setTimeout(r, 120));
    }
    next[code] = entry;
  }

  // DESKS: file every post, every run (no lookups, so this is quick)
  const counts = { unfiled: 0 }, byAccount = {}, unfiled = {};
  for (const d of DESKS) counts[d] = 0;
  for (const { code, post } of posts) {
    const entry = next[code];
    const f = deskOf(post, entry);
    if (f.desk) { entry.desk = f.desk; counts[f.desk]++; }
    else { delete entry.desk; if (post.kind !== 'editorial') counts.unfiled++; }
    if (post.kind === 'tweet') {
      const h = handleOf(post.url).toLowerCase();
      if (f.by !== 'account' && h) {
        const u = unfiled[h] || (unfiled[h] = { posts: 0, filed_by_words: [] });
        u.posts++;
        if (f.desk && u.filed_by_words.indexOf(f.desk) === -1) u.filed_by_words.push(f.desk);
      }
    }
    if (f.by) byAccount[f.by] = (byAccount[f.by] || 0) + 1;
  }
  const accounts = Object.keys(unfiled).sort((a, b) => unfiled[b].posts - unfiled[a].posts || (a < b ? -1 : 1))
    .map(h => ({ handle: h, posts: unfiled[h].posts, filed_by_words: unfiled[h].filed_by_words }));

  fs.rmSync(OUT, { recursive: true, force: true });
  for (const { code, post } of posts) {
    const dir = path.join(OUT, code);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), page(code, post, card(post, next[code])));
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(next, null, 1) + '\n');
  fs.writeFileSync(DESK_REPORT, JSON.stringify({
    note: 'Written by tools/build-share.js. X accounts below have no desk of their own yet; each was filed by its wording, or left unfiled.',
    desks: counts,
    filed_by: { account: byAccount.account || 0, words: byAccount.words || 0 },
    accounts_without_a_desk: accounts
  }, null, 1) + '\n');
  console.log(posts.length + ' share pages written; ' + looked + ' lookups this run, ' + got + ' returned a title; ' + marked + ' X posts given a media mark');
  console.log('desks: ' + DESKS.map(d => d + ' ' + counts[d]).join(', ') + ', unfiled ' + counts.unfiled);
  for (const h of Object.keys(strikes)) if (strikes[h] >= 4) console.log('note: lookups for "' + h + '" were failing, so the rest were skipped this run');
})().catch(e => { console.error(e); process.exit(1); });
