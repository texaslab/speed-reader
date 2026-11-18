// Turn conjugated Japanese back into dictionary forms (食べなかった -> 食べる).
// Each rule: [ending in text, ending in dictionary form, type the text form has, type the result has, label].
// Types are bit flags; 0 on an item means "any" (the text as typed).

export const V1 = 1, V5 = 2, VS = 4, VK = 8, ADJ = 16, MASU = 32, TE = 64;
const DICT = V1 | V5 | VS | VK | ADJ;

const U = 'うくぐすつぬぶむる';
const I = 'いきぎしちにびみり';
const A = 'わかがさたなばまら';
const E = 'えけげせてねべめれ';
const O = 'おこごそとのぼもろ';
const TE_FORM = ['って', 'いて', 'いで', 'して', 'って', 'んで', 'んで', 'んで', 'って'];
const TA_FORM = ['った', 'いた', 'いだ', 'した', 'った', 'んだ', 'んだ', 'んだ', 'った'];

const R = [];
const add = (from, to, tin, tout, why) => R.push([from, to, tin, tout, why]);

// polite forms collapse to ます first
add('ました', 'ます', 0, MASU, 'past');
add('ません', 'ます', 0, MASU, 'negative');
add('ませんでした', 'ます', 0, MASU, 'past negative');
add('ましょう', 'ます', 0, MASU, 'let\'s');
add('まして', 'ます', 0, MASU, 'te-form');
add('ませ', 'ます', 0, MASU, 'imperative');

// te-form helpers: 食べている -> 食べて
const TE_AUX = [
  ['いる', V1, 'progressive'], ['いた', 0, 'progressive past'], ['る', V1, 'progressive'], ['た', 0, 'progressive past'],
  ['しまう', V5, 'completed'], ['しまった', 0, 'completed'], ['おく', V5, 'in advance'], ['ある', V5, 'resulting state'],
  ['いく', V5, 'going on'], ['くる', VK, 'coming on'], ['くれる', V1, 'for me'], ['もらう', V5, 'have done'],
  ['あげる', V1, 'for someone'], ['ください', 0, 'please'], ['みる', V1, 'try'], ['も', 0, 'even if'], ['は', 0, 'topic'],
];
for (const [aux, t, why] of TE_AUX) {
  add('て' + aux, 'て', t, TE, why);
  add('で' + aux, 'で', t, TE, why);
}
add('ちゃう', 'て', V5, TE, 'completed');
add('じゃう', 'で', V5, TE, 'completed');
add('ちゃった', 'て', 0, TE, 'completed');
add('じゃった', 'で', 0, TE, 'completed');

// ichidan (食べる)
const v1 = (from, tin, why) => add(from, 'る', tin, V1 | VK, why);
v1('ます', MASU, 'polite');
v1('ない', ADJ, 'negative');
v1('た', 0, 'past');
v1('て', TE, 'te-form');
v1('たら', 0, 'if');
v1('たり', 0, 'and so on');
v1('られる', V1, 'passive / can');
v1('させる', V1, 'make do');
v1('させられる', V1, 'made to do');
v1('れる', V1, 'can');
v1('ろ', 0, 'imperative');
v1('よ', 0, 'imperative');
v1('れば', 0, 'if');
v1('よう', 0, 'let\'s');
v1('ず', 0, 'without');
v1('ずに', 0, 'without');
v1('ぬ', 0, 'negative');
v1('ん', 0, 'negative');
v1('たい', ADJ, 'want to');
v1('ながら', 0, 'while');
v1('なさい', 0, 'do it');
v1('すぎる', V1, 'too much');
v1('そう', 0, 'looks like');
v1('', 0, 'stem');

// godan (書く, 読む ...)
for (let k = 0; k < 9; k++) {
  const u = U[k];
  add(I[k] + 'ます', u, MASU, V5, 'polite');
  add(A[k] + 'ない', u, ADJ, V5, 'negative');
  add(A[k] + 'ず', u, 0, V5, 'without');
  add(A[k] + 'ずに', u, 0, V5, 'without');
  add(A[k] + 'ぬ', u, 0, V5, 'negative');
  add(A[k] + 'ん', u, 0, V5, 'negative');
  add(A[k] + 'れる', u, V1, V5, 'passive');
  add(A[k] + 'せる', u, V1, V5, 'make do');
  add(A[k] + 'される', u, V1, V5, 'made to do');
  add(A[k] + 'せられる', u, V1, V5, 'made to do');
  add(E[k] + 'る', u, V1, V5, 'can');
  add(E[k], u, 0, V5, 'imperative');
  add(E[k] + 'ば', u, 0, V5, 'if');
  add(O[k] + 'う', u, 0, V5, 'let\'s');
  add(I[k] + 'たい', u, ADJ, V5, 'want to');
  add(I[k] + 'ながら', u, 0, V5, 'while');
  add(I[k] + 'なさい', u, 0, V5, 'do it');
  add(I[k] + 'すぎる', u, V1, V5, 'too much');
  add(I[k] + 'そう', u, 0, V5, 'looks like');
  add(I[k], u, 0, V5, 'stem');
  add(TE_FORM[k], u, TE, V5, 'te-form');
  add(TA_FORM[k], u, 0, V5, 'past');
  add(TA_FORM[k] + 'ら', u, 0, V5, 'if');
  add(TA_FORM[k] + 'り', u, 0, V5, 'and so on');
}
// なさる, いらっしゃる, くださる, おっしゃる, ござる: polite stem ends in い
add('います', 'る', MASU, V5, 'polite');
add('い', 'る', 0, V5, 'imperative');
// 行く is irregular in te/ta
for (const head of ['行', 'い', '逝']) {
  add(head + 'って', head + 'く', TE, V5, 'te-form');
  add(head + 'った', head + 'く', 0, V5, 'past');
  add(head + 'ったら', head + 'く', 0, V5, 'if');
}

// suru: 勉強する is stored as 勉強 with type vs
const vs = (from, tin, why) => add(from, 'する', tin, VS, why);
vs('します', MASU, 'polite');
vs('しない', ADJ, 'negative');
vs('した', 0, 'past');
vs('して', TE, 'te-form');
vs('したら', 0, 'if');
vs('しよう', 0, 'let\'s');
vs('しろ', 0, 'imperative');
vs('せよ', 0, 'imperative');
vs('すれば', 0, 'if');
vs('される', V1, 'passive');
vs('させる', V1, 'make do');
vs('したい', ADJ, 'want to');
vs('しながら', 0, 'while');
vs('せず', 0, 'without');
vs('できる', V1, 'can');
add('する', '', VS, VS, 'suru verb');

// kuru (kana; kanji 来 is covered by the ichidan rules)
const vk = (from, tin, why) => add(from, 'くる', tin, VK, why);
vk('きます', MASU, 'polite'); vk('こない', ADJ, 'negative'); vk('きた', 0, 'past'); vk('きて', TE, 'te-form');
vk('こよう', 0, 'let\'s'); vk('こい', 0, 'imperative'); vk('くれば', 0, 'if'); vk('こられる', V1, 'passive / can');
vk('こさせる', V1, 'make do'); vk('きたい', ADJ, 'want to');
add('来い', '来る', 0, VK, 'imperative');

// i-adjectives
const adj = (from, tin, why) => add(from, 'い', tin, ADJ, why);
adj('く', 0, 'adverb');
adj('くて', 0, 'te-form');
adj('かった', 0, 'past');
adj('くない', ADJ, 'negative');
adj('ければ', 0, 'if');
adj('かったら', 0, 'if');
adj('さ', 0, 'noun');
adj('そう', 0, 'looks like');
adj('すぎる', V1, 'too much');
adj('くなる', V5, 'become');
adj('かろう', 0, 'probably');
adj('き', 0, 'classical');

R.sort((a, b) => b[0].length - a[0].length);

export function deinflect(text) {
  const out = [{ word: text, type: 0, why: [] }];
  const seen = new Map([[text + ':0', true]]);
  for (let q = 0; q < out.length && out.length < 300; q++) {
    const { word, type, why } = out[q];
    for (const [from, to, tin, tout, label] of R) {
      if (type !== 0 && !(type & tin)) continue;
      if (from === '' && type !== 0) continue;
      if (!word.endsWith(from)) continue;
      const base = word.slice(0, word.length - from.length) + to;
      if (!base || base === word && type === tout) continue;
      const key = base + ':' + tout;
      if (seen.has(key)) continue;
      seen.set(key, true);
      out.push({ word: base, type: tout, why: [label, ...why] });
    }
  }
  return out;
}

export function matchesType(itemType, classes) {
  if (itemType === 0) return true;
  if (!(itemType & DICT)) return false;
  let mask = 0;
  for (const c of classes) mask |= c === 'v1' ? V1 : c === 'v5' ? V5 : c === 'vs' ? VS : c === 'vk' ? VK : c === 'adj-i' ? ADJ : 0;
  return (mask & itemType) !== 0;
}
