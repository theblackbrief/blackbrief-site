// ── BLACK BRIEF: HOUSEKEEPING ──
// GitHub runs this by itself (see .github/workflows/share-pages.yml) each time
// posts.txt changes and once a day. It keeps the feed fresh:
//   - a post older than MAX_AGE_DAYS is removed
//   - never more than MAX_POSTS are kept
//   - never fewer than MIN_POSTS are kept (the newest ones stay, whatever their age)
//   - a tweet that X reports as deleted on two separate days is removed
// Nothing is thrown away: every removed line is added to old-posts.txt, which
// the site does not read. To bring a post back, move its line back into
// posts.txt. Nothing here changes index.html.
'use strict';
const fs = require('fs');
const path = require('path');

// ── the three numbers; change them here ──
const MAX_AGE_DAYS = 14;
const MAX_POSTS = 100;
const MIN_POSTS = 50;

const ROOT = path.join(__dirname, '..');
const POSTS = path.join(ROOT, 'posts.txt');
const OLD = path.join(ROOT, 'old-posts.txt');
const STATE = path.join(__dirname, 'housekeep-state.json');
const CHECK_DEAD = process.env.CHECK_DEAD === '1'; // only on the daily run
const DAY = 24 * 60 * 60 * 1000;
const RECHECK_MS = 20 * 60 * 60 * 1000; // a second "deleted" answer only counts this much later

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

// → { ts, tweet } for a line the site would show, or null for one it ignores
function parse(raw) {
  if (raw.length <= 8) return null;
  const m = raw.match(TS_RE);
  const ts = m ? Date.parse(m[1]) : NaN;
  const text = m ? raw.replace(TS_RE, ' ').replace(/\s+/g, ' ').trim() : raw;
  if (text.trimStart().charAt(0) === '§') return { ts, tweet: null };
  const url = safeUrl(stripTags(splitLabel(text)));
  if (!url) return null;
  return { ts, tweet: !ytId(url) && isTw(url) ? url.replace('x.com', 'twitter.com').split('?')[0] : null };
}

// 'gone' = X says the tweet does not exist; 'ok' = it is there; null = no clear answer
async function tweetStatus(url) {
  try {
    const r = await fetch('https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=' + encodeURIComponent(url), {
      signal: AbortSignal.timeout(6000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; blackbrief-housekeep/1.0; +https://theblackbrief.com)' }
    });
    if (r.status === 404) return 'gone';
    if (r.ok) return 'ok';
    return null;
  } catch (e) { return null; }
}

(async function main() {
  const now = Date.now();
  const raw = fs.readFileSync(POSTS, 'utf8');
  const all = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0); // oldest first

  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')) || {}; } catch (e) {}

  // read every line. A line with no date takes the date of the dated post
  // before it in the file; with none before it, it counts as old.
  let lastTs = 0;
  const rows = all.map(line => {
    const p = parse(line);
    if (!p) return { line, junk: true };
    let ts = p.ts;
    if (!isNaN(ts)) { ts = Math.min(ts, now); lastTs = ts; } else ts = lastTs;
    return { line, ts, tweet: p.tweet };
  });
  const posts = rows.filter(r => !r.junk).reverse(); // newest first
  if (posts.length === 0) { console.log('no posts found; nothing changed'); touch(); return; }

  // ── deleted tweets (daily run only) ──
  if (CHECK_DEAD) {
    const tweets = posts.slice(0, MAX_POSTS).filter(r => r.tweet);
    const gone = [], ok = [];
    for (const r of tweets) {
      const s = await tweetStatus(r.tweet);
      if (s === 'gone') gone.push(r.tweet); else if (s === 'ok') ok.push(r.tweet);
      await new Promise(res => setTimeout(res, 120));
    }
    // if X suddenly calls a large share of tweets deleted, distrust the whole answer
    if (gone.length > Math.max(5, tweets.length * 0.25)) {
      console.log('note: X reported ' + gone.length + ' of ' + tweets.length + ' tweets as deleted; that looks wrong, so none were counted');
    } else {
      for (const u of ok) delete state[u];
      for (const u of gone) {
        const e = state[u];
        if (!e) state[u] = { n: 1, t: now };
        else if (now - e.t >= RECHECK_MS) state[u] = { n: e.n + 1, t: now };
      }
      console.log('checked ' + tweets.length + ' tweets: ' + gone.length + ' reported deleted');
    }
  }

  // ── decide what stays ──
  const removed = new Set();
  let dead = 0, junk = 0, aged = 0;
  for (const r of rows) if (r.junk) { removed.add(r); junk++; }
  const alive = posts.filter(r => {
    if (r.tweet && state[r.tweet] && state[r.tweet].n >= 2) { removed.add(r); dead++; return false; }
    return true;
  });
  alive.forEach((r, i) => {
    const keep = i < MIN_POSTS || (i < MAX_POSTS && now - r.ts < MAX_AGE_DAYS * DAY);
    if (!keep) { removed.add(r); aged++; }
  });

  const kept = rows.filter(r => !removed.has(r));
  if (kept.length === 0) { console.log('that would empty the feed; nothing changed'); touch(); return; }

  // forget tweets that are no longer in the feed
  const still = {};
  for (const r of kept) if (r.tweet && state[r.tweet]) still[r.tweet] = state[r.tweet];

  if (removed.size > 0) {
    const out = rows.filter(r => removed.has(r)).map(r => r.line);
    fs.appendFileSync(OLD, out.join('\n') + '\n');
    fs.writeFileSync(POSTS, kept.map(r => r.line).join('\n') + (raw.endsWith('\n') ? '\n' : ''));
  }
  fs.writeFileSync(STATE, JSON.stringify(still, null, 1) + '\n');
  touch();
  console.log(kept.length + ' posts kept; removed ' + aged + ' old, ' + dead + ' deleted tweets, ' + junk + ' unreadable lines');
})().catch(e => { console.error(e); process.exit(1); });

// make sure both side files exist, so the workflow can always save them
function touch() {
  if (!fs.existsSync(OLD)) fs.writeFileSync(OLD, '');
  if (!fs.existsSync(STATE)) fs.writeFileSync(STATE, '{}\n');
}
