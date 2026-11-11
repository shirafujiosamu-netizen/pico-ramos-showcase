/* lyric.js — 给当前媒体会话找时间轴歌词。
 * 网易云的公开搜索 / 歌词接口不需要登录，但要带 UA 和 Referer；
 * 失败时也回 200，所以要看 body 里的 code。 */
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const REF = 'https://music.163.com/';

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA, Referer: REF, Accept: 'application/json' },
      timeout: 8000,
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (err) { reject(err); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/* “(Live)”“(feat. X)”这类括号后缀会干扰搜索 */
function stripBrackets(s) {
  return String(s || '').replace(/[（(][^)）]*[)）]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* SMTC 常见两种： “歌名 - 歌手” 或只有 “歌名” */
function splitTitle(raw) {
  const t = String(raw || '').trim();
  const m = t.match(/^(.*?)\s+[-–—]\s+(.+)$/);
  if (m) return { title: m[1].trim(), artist: m[2].trim() };
  return { title: t, artist: '' };
}

async function searchSong(title, artist) {
  const url = 'https://music.163.com/api/search/get/web?s=' + encodeURIComponent(stripBrackets(title)) + '&type=1&limit=8';
  const data = await getJson(url);
  const songs = (data && data.result && data.result.songs) || [];
  if (!songs.length) return null;
  const want = String(artist || '').toLowerCase();
  if (want) {
    const hit = songs.find((s) => (s.artists || []).some((a) => {
      const n = String(a.name || '').toLowerCase();
      return n && (n.includes(want) || want.includes(n));
    }));
    if (hit) return hit;
  }
  return songs[0];
}

/* [mm:ss.xx] 可一行多时间戳；纯文本行与空行丢弃 */
function parseLrc(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const stamps = raw.match(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g);
    if (!stamps) continue;
    const body = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!body) continue;
    for (const st of stamps) {
      const m = st.match(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/);
      const frac = m[3] ? Number('0.' + m[3]) : 0;
      out.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text: body });
    }
  }
  out.sort((a, b) => a.t - b.t);
  const dedup = [];
  for (const line of out) {
    if (dedup.length && Math.abs(dedup[dedup.length - 1].t - line.t) < 0.01) continue;
    dedup.push(line);
  }
  return dedup;
}

const cache = new Map();
const CACHE_MAX = 60;

async function lyricFor(rawTitle, rawArtist) {
  const split = splitTitle(rawTitle);
  const title = split.title;
  const artist = rawArtist || split.artist;
  const key = (title + '|' + artist).toLowerCase();
  if (cache.has(key)) return cache.get(key);

  let lines = [];
  try {
    const song = await searchSong(title, artist);
    if (song) {
      const data = await getJson('https://music.163.com/api/song/lyric?id=' + song.id + '&lv=1&kv=1&tv=-1');
      lines = parseLrc(data && data.lrc && data.lrc.lyric);
    }
  } catch (err) {
    lines = [];
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, lines);
  return lines;
}

module.exports = { lyricFor, parseLrc, splitTitle };
