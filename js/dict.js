// Japanese-English lookup over the JMdict shards in dict/.
// lookup(text) tries the longest piece of text first, undoing conjugation.

import { deinflect, matchesType } from './deinflect.js';

const SHARDS = 64;
const cache = new Map();
let base = 'dict/';

export function setDictBase(url) { base = url; }

function shardOf(ch) { return ch.codePointAt(0) % SHARDS; }

const KEEP = 8; // parsed shards kept in memory; the browser cache holds the rest

function loadShard(n) {
  if (cache.has(n)) {
    const p = cache.get(n);
    cache.delete(n); cache.set(n, p); // most recently used last
    return p;
  }
  if (!cache.has(n)) {
    while (cache.size >= KEEP) cache.delete(cache.keys().next().value);
    const p = fetch(`${base}${String(n).padStart(2, '0')}.json`)
      .then(r => { if (!r.ok) throw new Error(`dictionary file ${n}: ${r.status}`); return r.json(); })
      .catch(e => { cache.delete(n); throw e; });
    cache.set(n, p);
  }
  return cache.get(n);
}

function kataToHira(s) {
  return s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

const MAX_LEN = 14;
const MAX_RESULTS = 6;

export async function lookup(text) {
  const src = Array.from(text.replace(/^[\s「『（(“"']+/, '')).slice(0, MAX_LEN).join('');
  if (!src) return [];
  const chars = Array.from(src);
  // gather candidates for every prefix
  const tries = [];
  for (let len = chars.length; len >= 1; len--) {
    const s = chars.slice(0, len).join('');
    const forms = deinflect(s);
    const hira = kataToHira(s);
    if (hira !== s) forms.push(...deinflect(hira));
    tries.push({ s, forms });
  }
  const need = new Set();
  for (const t of tries) for (const f of t.forms) need.add(shardOf(f.word));
  const shards = {};
  await Promise.all([...need].map(async n => { shards[n] = await loadShard(n); }));

  const results = [];
  const seen = new Set();
  for (const t of tries) {
    for (const f of t.forms) {
      const sh = shards[shardOf(f.word)];
      const idxs = sh && sh.i[f.word];
      if (!idxs) continue;
      for (const i of idxs) {
        const e = sh.e[i];
        if (!matchesType(f.type, e[2])) continue;
        const key = e[0].join('|') + '/' + e[1].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          matched: t.s,
          base: f.word,
          why: f.why,
          kanji: e[0], kana: e[1], senses: e[3], common: !!e[4],
        });
      }
    }
    if (results.length >= MAX_RESULTS) break;
  }
  // within each matched length: plain matches before deinflected, common first
  results.sort((a, b) => (b.matched.length - a.matched.length) || (a.why.length - b.why.length) || (b.common - a.common));
  return results.slice(0, MAX_RESULTS);
}

// Headword to show: the kanji form that matched, else the first kanji form, else kana.
export function headword(r) {
  const hit = r.kanji.find(k => k === r.base);
  return hit || r.kanji[0] || r.kana.find(k => k === r.base) || r.kana[0];
}
export function reading(r) {
  const h = headword(r);
  if (r.kana.includes(h)) return '';
  return r.kana.includes(r.base) ? r.base : r.kana[0];
}
