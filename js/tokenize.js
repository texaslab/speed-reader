// Split paragraphs into the units shown one at a time.
// English: words (very long words are split). Japanese: short phrase chunks built
// from Intl.Segmenter words, with particles and endings glued to the word before.

export const TOKENIZER_VERSION = 1;

const KANJI = /[㐀-鿿豈-﫿々〆ヶ]/;
const KATA = /[゠-ヿｦ-ﾟ]/;
const HIRA_ONLY = /^[぀-ゟー]+$/;
const OPEN = /^[「『（(［\[｛{〈《【〔“‘"'＜]+$/;
const CLOSE_OR_PUNCT = /^[」』）)］\]｝}〉》】〕”’"'＞。、，．！？!?,.・…‥：；:;ー〜～\-—―]+$/;
const STOP = /[。！？!?…]$/;
const COMMA = /[、，,]$/;
const AUX = new Set(['ている', 'ていた', 'ました', 'ません', 'でした', 'ます', 'ない', 'なかった', 'ください', 'ござい',
  'ある', 'いる', 'おり', 'ます', 'れる', 'られる', 'せる', 'させる', 'たい', 'だろう', 'でしょう', 'です', 'だった', 'のです', 'んです']);
const JA_MAX = 9;

function enTokens(text) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) {
    const w = m[0];
    const start = m.index;
    // split at em/en dashes joining two words
    const pieces = w.split(/(?<=[—–])(?=\S)/);
    let o = start;
    for (const piece of pieces) {
      for (const part of splitLong(piece)) {
        out.push([part.text, o + part.at]);
      }
      o += piece.length;
    }
  }
  return out;
}

function splitLong(w) {
  if (w.length <= 13) return [{ text: w, at: 0 }];
  // at hyphens first
  if (/\w-\w/.test(w)) {
    const parts = [];
    let at = 0;
    for (const seg of w.split(/(?<=-)/)) { parts.push({ text: seg, at }); at += seg.length; }
    return parts.flatMap(p => p.text.length > 13 ? splitLong(p.text).map(q => ({ text: q.text, at: p.at + q.at })) : [p]);
  }
  const parts = [];
  const n = Math.ceil(w.length / 9);
  const size = Math.ceil(w.length / n);
  for (let i = 0; i < w.length; i += size) {
    const last = i + size >= w.length;
    parts.push({ text: w.slice(i, i + size) + (last ? '' : '-'), at: i });
  }
  return parts;
}

let segmenter = null;
function jaSegments(text) {
  if (!segmenter && typeof Intl !== 'undefined' && Intl.Segmenter) {
    segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
  }
  if (segmenter) return Array.from(segmenter.segment(text), s => [s.segment, s.index]);
  // Fallback: split into script runs
  const out = [];
  const re = /[㐀-鿿豈-﫿々〆ヶ]+[぀-ゟ]*|[゠-ヿー]+|[぀-ゟ]+|[A-Za-z0-9]+|\s+|./gu;
  let m;
  while ((m = re.exec(text))) out.push([m[0], m.index]);
  return out;
}

function jaTokens(text) {
  const out = [];
  let cur = null; // [text, offset]
  const push = () => { if (cur) out.push(cur); cur = null; };
  for (const [seg, idx] of jaSegments(text)) {
    if (!seg.trim()) { continue; }
    if (!cur) { cur = [seg, idx]; continue; }
    const t = cur[0];
    const lastCh = t[t.length - 1];
    const ended = STOP.test(t) || COMMA.test(t) || /[」』）)］】〕”]$/.test(t);
    if (CLOSE_OR_PUNCT.test(seg)) { cur[0] = text.slice(cur[1], idx + seg.length); continue; }
    if (OPEN.test(t)) { cur[0] = text.slice(cur[1], idx + seg.length); continue; }
    if (OPEN.test(seg)) { push(); cur = [seg, idx]; continue; }
    if (ended) { push(); cur = [seg, idx]; continue; }
    const len = t.length + seg.length;
    if (HIRA_ONLY.test(seg) && len <= JA_MAX &&
        (seg.length <= 2 || KANJI.test(lastCh) || AUX.has(seg) || (HIRA_ONLY.test(t) && t.length <= 2))) {
      cur[0] = text.slice(cur[1], idx + seg.length);
      continue;
    }
    // honorific prefix お/ご glued to the next word
    if ((t === 'お' || t === 'ご' || t === '御') && !HIRA_ONLY.test(seg)) { cur[0] = text.slice(cur[1], idx + seg.length); continue; }
    // a lone kanji right after a kanji word is usually part of it (釈迦+様, 日本+人)
    if (seg.length === 1 && KANJI.test(seg) && KANJI.test(lastCh) && len <= 5) { cur[0] = text.slice(cur[1], idx + seg.length); continue; }
    push();
    cur = [seg, idx];
  }
  push();
  return out;
}

export function tokenizeBook(book) {
  const ja = book.lang === 'ja';
  const paras = [];
  const words = [];
  const paraOf = [];
  const offs = [];
  const paraStart = [];
  const chapters = [];
  for (const ch of book.chapters) {
    const start = words.length;
    for (const p of ch.paras) {
      const toks = ja ? jaTokens(p) : enTokens(p);
      if (!toks.length) continue;
      const pi = paras.length;
      paras.push(p);
      paraStart.push(words.length);
      for (const [w, o] of toks) { words.push(w); paraOf.push(pi); offs.push(o); }
    }
    if (words.length > start) chapters.push(ch.body ? { title: ch.title, start, body: true } : { title: ch.title, start });
  }
  return {
    paras, words, chapters,
    para: Int32Array.from(paraOf),
    off: Int32Array.from(offs),
    paraStart: Int32Array.from(paraStart),
    v: TOKENIZER_VERSION,
  };
}

// Index of the letter shown in red.
export function pivotIndex(word, ja) {
  const chars = Array.from(word);
  let lead = 0;
  while (lead < chars.length - 1 && /[^\p{L}\p{N}]/u.test(chars[lead])) lead++;
  let tail = chars.length;
  while (tail > lead + 1 && /[^\p{L}\p{N}]/u.test(chars[tail - 1])) tail--;
  const n = tail - lead;
  let i;
  if (ja) i = n <= 1 ? 0 : n <= 3 ? 1 : Math.min(n - 1, Math.round(n * 0.35));
  else i = n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4;
  return lead + i;
}

const ABBR = /^["'“‘(]*(Mr|Mrs|Ms|Dr|St|Mt|Jr|Sr|Prof|Rev|Gen|Col|Capt|Lt|vs|etc|e\.g|i\.e|No|[A-Z])\.$/;

export function isSentenceEnd(word) {
  return /[.!?。！？…]["'”’」』）)\]]*$/.test(word) && !ABBR.test(word);
}

export function isKanji(ch) { return KANJI.test(ch); }
export function isKatakana(ch) { return KATA.test(ch); }
