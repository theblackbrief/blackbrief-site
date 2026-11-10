// ── BLACK BRIEF: SHARE PAGE BUILDER ──
// GitHub runs this by itself every time posts.txt changes (see
// .github/workflows/share-pages.yml). For each post it writes a tiny page at
//   /p/<code>/index.html
// holding that post's own preview title and description, which then sends the
// visitor on to the post on the main site. Nothing here changes index.html.
//
// It also keeps tools/share-cache.json, which the main site reads to draw its
// X cards (Oct 2026): for each X post, its wording ("title") and whether it
// carries a video or an image ("media"). It also files every post under a
// subject desk ("desk"; see DESKS below).
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

// ── DESKS (rebuilt Nov 2026) ──
// Every post is filed under ONE subject desk, shown in the ticker as
// [ 12 /money ] and on the card, and tappable to filter the feed.
// Since Nov 2026 an AI reads each post and picks the desk (it replaced the
// word lists, which kept mislabelling posts). It runs on GitHub Models, the
// free AI service that comes with every GitHub account: no key, no account,
// no cost. The workflow's built-in token is allowed to use it by the line
// "models: read" in .github/workflows/share-pages.yml.
//   - Each post is filed ONCE and remembered in share-cache.json ("desk").
//     An X post is filed once its wording has arrived from X.
//   - YOUR WORD WINS: tag a post with a desk name (#world, #politics...) and
//     it goes to that desk, whatever the AI said. The site shows no stamp for
//     a desk tag. The bb/edit tag Shortcut does this: custom → "world".
//   - If the AI cannot be reached, the post stays unfiled and is tried again
//     on the next run. Nothing else is affected.
//   - Editorials are never filed: they are the curator's own voice.
// The descriptions below are what the AI reads when it decides. Change them
// (and raise DESK_VERSION by one) to have the whole feed filed again.
const DESKS = ['politics', 'world', 'money', 'tech', 'anomaly'];
const DESK_VERSION = 1;
const DESK_RULES = {
  politics: 'US government and politics: the White House, Congress, elections, courts, parties, the DOJ and FBI, immigration and border policy, culture-war fights inside the US, and church-and-state disputes in the US.',
  world: 'Anything centred outside the US: wars and military action anywhere (including US strikes abroad), foreign governments and leaders, diplomacy, sanctions as foreign policy, terrorism, international crises, religious conflict abroad.',
  money: 'Markets, stocks, the economy, the Fed, inflation, jobs, prices and housing, oil and commodities, crypto, prediction markets and betting odds (Polymarket, Kalshi), companies as businesses (earnings, deals, layoffs, stock moves).',
  tech: 'Technology and science: AI, big tech products and platforms, chips, cyber attacks and hacking, surveillance tech, space and rockets, scientific discoveries.',
  anomaly: 'The strange and the alarming that fits nowhere else: disease outbreaks and health scares, natural disasters, extreme weather, earthquakes, UFOs and UAPs, unexplained events, missing people, bizarre incidents, crime oddities.'
};
const DESK_EDGES = [
  'A US strike or military action abroad goes to world.',
  'A bill or fight in Congress goes to politics, even if it is about money or another country.',
  'A company\'s stock, earnings or business deal goes to money; its new product or technology goes to tech.',
  'Betting odds or a prediction market on any subject go to money.',
  'A disaster or outbreak goes to anomaly, unless the post is mainly about a government\'s response to it.',
  'The account that posted is only a hint; the wording decides.'
];
const AI_URL = process.env.MODELS_URL || 'https://models.github.ai/inference/chat/completions';
const AI_MODEL = 'openai/gpt-4.1-mini';
const AI_BATCH = 20;   // posts per question (the free tier allows ~150 questions a day)
const AI_TRIES = 3;    // per post, before it is left unfiled for good

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

function tagOf(l) { const m = String(l).toLowerCase().match(/#([a-z0-9]+)/); return m ? m[1] : ''; } // as getTag() in index.html
function parse(raw) {
  const m = raw.match(TS_RE);
  const text = m ? raw.replace(TS_RE, ' ').replace(/\s+/g, ' ').trim() : raw;
  const tag = tagOf(text);
  if (text.trimStart().charAt(0) === '§') {
    const id = text.replace(/\s+#\w+/g, '').trim();
    return { kind: 'editorial', id, text: id.replace(/^§\s*/, '').trim(), tag };
  }
  const parts = splitLabel(text);
  const url = safeUrl(stripTags(parts.urlPart));
  if (!url) return null;
  const kind = ytId(url) ? 'video' : isTw(url) ? 'tweet' : 'article';
  return { kind, id: url, url, label: parts.label, tag };
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

// ── DESK FILING (Nov 2026) ──
// The words the AI reads for a post, or '' if there is nothing to read yet.
function deskText(post, entry) {
  if (post.kind === 'editorial') return '';
  if (post.kind === 'tweet') {
    if (!entry || !entry.title) return ''; // wording not here yet (or X no longer has it)
    return entry.title; // "@Handle: wording"
  }
  if (post.kind === 'video') return entry && entry.title ? 'YouTube video: ' + entry.title : '';
  const t = post.label || (entry && entry.title) || '';
  return t ? domain(post.url) + ': ' + t : '';
}

let aiDown = ''; // set when the AI service fails; no more questions this run
async function askDesks(items) {
  // items: [{ n, text }] → { n: desk }
  const token = process.env.GITHUB_TOKEN;
  if (!token) { aiDown = 'no GITHUB_TOKEN (run inside GitHub Actions)'; return null; }
  const sys = 'You file news posts for a news feed into exactly one desk each.\n\nDesks:\n' +
    DESKS.map(d => '- ' + d + ': ' + DESK_RULES[d]).join('\n') +
    '\n\nRules for the borders:\n' + DESK_EDGES.map(r => '- ' + r).join('\n') +
    '\n\nRead each post the way a news editor would, including sarcasm and context. Every post gets exactly one of: ' +
    DESKS.join(', ') + '. Answer with a JSON object only, mapping each post number to its desk, e.g. {"1":"world","2":"money"}.';
  const user = items.map(i => i.n + '. ' + i.text.replace(/\s+/g, ' ').slice(0, 600)).join('\n');
  try {
    const r = await fetch(AI_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, accept: 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL, temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }]
      })
    });
    if (!r.ok) {
      const body = (await r.text().catch(() => '')).slice(0, 300);
      aiDown = 'HTTP ' + r.status + ' ' + body;
      return null;
    }
    const j = await r.json();
    const txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '';
    const m = String(txt).match(/\{[\s\S]*\}/);
    if (!m) return {};
    const o = JSON.parse(m[0]);
    const out = {};
    for (const k of Object.keys(o)) {
      const d = String(o[k] || '').toLowerCase().replace(/^\//, '').trim();
      if (DESKS.indexOf(d) !== -1) out[String(k).trim()] = d;
    }
    return out;
  } catch (e) {
    aiDown = String(e && e.message || e);
    return null;
  }
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

  // DESKS: your desk tag wins; otherwise the AI files each post once
  const counts = { unfiled: 0 }, by = { you: 0, ai: 0 }, waiting = [];
  for (const d of DESKS) counts[d] = 0;
  const toAsk = [];
  for (const { code, post } of posts) {
    const entry = next[code];
    if (post.kind === 'editorial') { delete entry.desk; delete entry.dby; delete entry.dv; delete entry.dtries; continue; }
    if (DESKS.indexOf(post.tag) !== -1) { entry.desk = post.tag; entry.dby = 'you'; entry.dv = DESK_VERSION; delete entry.dtries; continue; }
    if (entry.dby === 'you') { delete entry.desk; delete entry.dby; delete entry.dv; } // tag since removed: file it afresh
    if (entry.dby === 'ai' && entry.dv === DESK_VERSION && DESKS.indexOf(entry.desk) !== -1) continue;
    if (entry.dv === DESK_VERSION && (entry.dtries || 0) >= AI_TRIES) continue; // given up on
    if (DESKS.indexOf(entry.desk) === -1 || entry.dv !== DESK_VERSION) { delete entry.desk; delete entry.dby; }
    if (entry.dv !== DESK_VERSION) { delete entry.dtries; delete entry.dv; }
    const text = deskText(post, entry);
    if (text) toAsk.push({ code, entry, text });
  }
  let asked = 0, filed = 0;
  for (let i = 0; i < toAsk.length && !aiDown; i += AI_BATCH) {
    const chunk = toAsk.slice(i, i + AI_BATCH);
    const ans = await askDesks(chunk.map((c, k) => ({ n: k + 1, text: c.text })));
    if (ans === null) break; // service down or refused: try again next run
    asked++;
    chunk.forEach((c, k) => {
      const d = ans[String(k + 1)];
      if (d) { c.entry.desk = d; c.entry.dby = 'ai'; c.entry.dv = DESK_VERSION; delete c.entry.dtries; filed++; }
      else { c.entry.dtries = (c.entry.dtries || 0) + 1; if (c.entry.dtries >= AI_TRIES) c.entry.dv = DESK_VERSION; }
    });
    if (i + AI_BATCH < toAsk.length) await new Promise(r => setTimeout(r, 5000)); // stay well under the per-minute limit
  }
  const recent = [];
  for (const { code, post } of posts) {
    if (post.kind === 'editorial') continue;
    const entry = next[code];
    if (DESKS.indexOf(entry.desk) !== -1) { counts[entry.desk]++; by[entry.dby === 'you' ? 'you' : 'ai']++; }
    else { counts.unfiled++; waiting.push(clip(deskText(post, entry) || post.url, 100)); }
    if (recent.length < 20) recent.push((entry.desk ? '/' + entry.desk + (entry.dby === 'you' ? ' (yours)' : '') : 'unfiled') + '  ' + clip(deskText(post, entry) || post.url, 110));
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  for (const { code, post } of posts) {
    const dir = path.join(OUT, code);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), page(code, post, card(post, next[code])));
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(next, null, 1) + '\n');
  fs.writeFileSync(DESK_REPORT, JSON.stringify({
    note: 'Written by tools/build-share.js. Desks are picked by an AI (GitHub Models), or by you with a desk tag such as #world. Unfiled posts are waiting for their wording or for the AI, and are tried again on the next run.',
    desks: counts,
    filed_by: { ai: by.ai, you: by.you },
    ai: aiDown ? 'could not reach the AI this run: ' + aiDown : 'ok; ' + filed + ' posts filed this run (' + asked + ' questions)',
    newest: recent,
    unfiled_posts: waiting
  }, null, 1) + '\n');
  console.log(posts.length + ' share pages written; ' + looked + ' lookups this run, ' + got + ' returned a title; ' + marked + ' X posts given a media mark');
  console.log('desks: ' + DESKS.map(d => d + ' ' + counts[d]).join(', ') + ', unfiled ' + counts.unfiled + ' (' + filed + ' filed by the AI this run)');
  if (aiDown) console.log('note: the AI could not be reached, so unfiled posts wait for the next run: ' + aiDown);
  for (const h of Object.keys(strikes)) if (strikes[h] >= 4) console.log('note: lookups for "' + h + '" were failing, so the rest were skipped this run');
})().catch(e => { console.error(e); process.exit(1); });
