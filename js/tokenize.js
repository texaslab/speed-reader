// Split paragraphs into the units shown one at a time.
// English: words (very long words are split). Japanese: short phrase chunks built
// from Intl.Segmenter words, with particles and endings glued to the word before.

export const TOKENIZER_VERSION = 2;

const KANJI = /[㐀-鿿豈-﫿々〆ヶ]/;
const KATA = /[゠-ヿｦ-ﾟ]/;
const HIRA_ONLY = /^[぀-ゟー]+$/;
const OPEN = /^[「『（(［\[｛{〈《【〔“‘"'＜]+$/;
const CLOSE_OR_PUNCT = /^[」』）)］\]｝}〉》】〕”’"'＞。、，．！？!?,.・…‥：；:;ー〜～\-—―]+$/;
const STOP = /[。！？!?…]$/;
const COMMA = /[、，,]$/;
// two-plus-kana pieces that never stand alone: particles, endings, conjugation parts
const END = new Set(['って', 'った', 'って', 'ない', 'なく', 'なかっ', 'ます', 'まし', 'ませ', 'ません', 'ました', 'でし', 'した', 'して',
  'てい', 'ている', 'ていた', 'いる', 'いた', 'れる', 'られ', 'られる', 'せる', 'させ', 'たい', 'たら', 'れば', 'だっ', 'です',
  'から', 'まで', 'より', 'には', 'では', 'とは', 'への', 'ので', 'のに', 'でも', 'など', 'そう', 'しょう', 'ましょう', 'でしょう', 'だろう']);
const JA_MAX = 5;  // a word and its particle
const TAIL_MAX = 10; // a verb or adjective keeps all its endings (いらっしゃいました)

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
  if (segmenter) return keepWhole(Array.from(segmenter.segment(text), s => [s.segment, s.index]), text);
  // Fallback: split into script runs
  const out = [];
  const re = /[㐀-鿿豈-﫿々〆ヶ]+[぀-ゟ]*|[゠-ヿー]+|[぀-ゟ]+|[A-Za-z0-9]+|\s+|./gu;
  let m;
  while ((m = re.exec(text))) out.push([m[0], m.index]);
  return out;
}

// Words the segmenter cuts into odd pieces (ご|ざ|いま|しょう) are put back together,
// so ございます shows as its own word instead of trailing the one before.
const WHOLE = /ござ(?:い(?:ま(?:す|した|せん|しょう)?)?|る)/g;
function keepWhole(segs, text) {
  const spans = [];
  for (const m of text.matchAll(WHOLE)) spans.push([m.index, m.index + m[0].length]);
  if (!spans.length) return segs;
  const out = [];
  let k = 0;
  for (const [seg, idx] of segs) {
    while (k < spans.length && spans[k][1] <= idx) k++;
    const sp = spans[k];
    if (sp && idx < sp[1] && idx + seg.length > sp[0]) {
      // segment overlaps a whole-word span: split off any part before it, fold the rest into it
      if (idx < sp[0]) out.push([seg.slice(0, sp[0] - idx), idx]);
      const prev = out[out.length - 1];
      if (prev && prev[1] === sp[0] && prev.whole) {
        prev[0] = text.slice(sp[0], Math.max(sp[1], idx + seg.length));
      } else {
        const w = [text.slice(sp[0], Math.max(sp[1], idx + seg.length)), sp[0]];
        w.whole = true;
        out.push(w);
      }
      continue;
    }
    out.push([seg, idx]);
  }
  return out;
}

// One word per unit: a segmenter word plus the bits that cannot stand alone
// (a one-kana particle or ending, conjugation pieces, punctuation), kept short.
function jaTokens(text) {
  const out = [];
  let cur = null; // [text, offset, letters]
  const push = () => { if (cur) out.push([cur[0], cur[1]]); cur = null; };
  const add = (seg, idx, letters) => { cur[0] = text.slice(cur[1], idx + seg.length); cur[2] += letters; };
  for (const [seg, idx] of jaSegments(text)) {
    if (!seg.trim()) { continue; }
    const n = Array.from(seg).length;
    if (!cur) { cur = [seg, idx, CLOSE_OR_PUNCT.test(seg) || OPEN.test(seg) ? 0 : n]; continue; }
    const t = cur[0];
    const lastCh = t[t.length - 1];
    const ended = STOP.test(t) || COMMA.test(t) || /[」』）)］】〕”]$/.test(t);
    if (CLOSE_OR_PUNCT.test(seg)) { add(seg, idx, 0); continue; }
    if (OPEN.test(t)) { add(seg, idx, n); continue; }
    if (OPEN.test(seg)) { push(); cur = [seg, idx, 0]; continue; }
    if (ended) { push(); cur = [seg, idx, n]; continue; }
    const len = cur[2] + n;
    const tail = (n === 1 || END.has(seg)) && /[ぁ-ゖ]$/.test(t);
    if (HIRA_ONLY.test(seg) && len <= (tail ? TAIL_MAX : JA_MAX) &&
        (n === 1 || END.has(seg) || (HIRA_ONLY.test(t) && cur[2] === 1))) {
      add(seg, idx, n);
      continue;
    }
    // honorific prefix お/ご/御 glued to the next word
    if ((t === 'お' || t === 'ご' || t === '御') && !HIRA_ONLY.test(seg)) { add(seg, idx, n); continue; }
    // a lone kanji right after a kanji word is usually part of it (釈迦+様, 日本+人)
    if (n === 1 && KANJI.test(seg) && KANJI.test(lastCh) && len <= JA_MAX) { add(seg, idx, n); continue; }
    push();
    cur = [seg, idx, n];
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

// A book stored by an older tokenizer, split again with the current rules.
// Returns the new text and the reading position moved to the same spot.
export function retokenize(text, lang, pos) {
  const chapters = text.chapters.map((c, i) => {
    const end = i + 1 < text.chapters.length ? text.chapters[i + 1].start : text.words.length;
    const paras = [];
    for (let p = 0; p < text.paras.length; p++) {
      if (text.paraStart[p] >= c.start && text.paraStart[p] < end) paras.push(text.paras[p]);
    }
    return c.body ? { title: c.title, paras, body: true } : { title: c.title, paras };
  });
  const next = tokenizeBook({ lang, chapters });
  let at = 0;
  if (pos > 0 && pos < text.words.length) {
    const p = text.para[pos], off = text.off[pos];
    if (p < next.paras.length) {
      at = next.paraStart[p];
      while (at + 1 < next.words.length && next.para[at + 1] === p && next.off[at + 1] <= off) at++;
    }
  }
  return { text: next, pos: at };
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
