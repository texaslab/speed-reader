import { parseEpub, parsePlainText, EpubError } from './epub.js';
import { tokenizeBook, retokenize, TOKENIZER_VERSION, pivotIndex, isSentenceEnd } from './tokenize.js';
import { Player } from './player.js';
import * as db from './store.js';
import { lookup, headword, reading } from './dict.js';

export const APP_VERSION = '0.1.1 beta';
const SAMPLES = {
  'sherlock-holmes': 'samples/sherlock-holmes.epub',
  'kumo-no-ito': 'samples/kumo-no-ito.epub',
};

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const settings = db.loadSettings();
let books = [];
let cur = null; // { book, text, player, chapter }
let wakeLock = null;

// ---------- theme & settings ----------
function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', settings.theme);
  root.style.setProperty('--word-size', settings.size + 'px');
  document.querySelectorAll('[data-theme-opt]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.themeOpt === settings.theme)));
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(document.body).backgroundColor;
}
function saveSettings() { db.saveSettings(settings); }

// ---------- toast ----------
let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- sheets ----------
let openSheet = null;
function showSheet(id) {
  closeSheet();
  openSheet = $(id);
  openSheet.hidden = false;
  $('#scrim').hidden = false;
}
function closeSheet() {
  if (openSheet) openSheet.hidden = true;
  openSheet = null;
  $('#scrim').hidden = true;
}
$('#scrim').addEventListener('click', closeSheet);
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheet));

// ---------- time formatting ----------
function fmtTime(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return '<1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ---------- library ----------
async function refreshLibrary() {
  books = await db.allBooks();
  const list = $('#books');
  list.textContent = '';
  for (const b of books) {
    const li = el('li', 'book');
    const open = el('button', 'book-open');
    open.append(el('span', 'book-title', b.title));
    if (b.author) open.append(el('span', 'book-author', b.author));
    const meta = el('span', 'book-meta');
    meta.append(el('span', 'lang', b.lang === 'ja' ? '日本語' : 'EN'));
    const bar = el('span', 'bar'); const fill = el('i');
    const pct = b.count > 1 ? b.pos / (b.count - 1) : 0;
    fill.style.width = (pct * 100).toFixed(1) + '%';
    bar.append(fill);
    meta.append(bar, el('span', '', `${Math.round(pct * 100)}%` + (b.left ? ` · ${fmtTime(b.left)} left` : '')));
    open.append(meta);
    open.addEventListener('click', () => openBook(b.id));
    const more = el('button', 'icon-btn');
    more.setAttribute('aria-label', `Options for ${b.title}`);
    more.innerHTML = '<svg><use href="#i-more"/></svg>';
    more.addEventListener('click', () => bookOptions(b));
    li.append(open, more);
    list.append(li);
  }
  $('#lib-empty').hidden = books.length > 0;
  refreshWordCount();
}

function bookOptions(b) {
  $('#bk-title').textContent = b.title;
  const del = $('#bk-delete');
  del.textContent = 'Delete';
  del.dataset.armed = '';
  del.onclick = async () => {
    if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; return; }
    await db.deleteBook(b.id);
    closeSheet();
    toast(`Deleted ${b.title}`);
    refreshLibrary();
  };
  $('#bk-restart').onclick = async () => {
    b.pos = 0;
    await db.putBook(b);
    closeSheet();
    refreshLibrary();
  };
  showSheet('#sheet-book');
}

async function importParsed(parsed, extra = {}) {
  const text = tokenizeBook(parsed);
  if (!text.words.length) throw new EpubError('No readable text found');
  const id = db.newId();
  const est = new Player({ text, lang: parsed.lang, settings, onWord() {}, onState() {} });
  const book = {
    id, title: parsed.title, author: parsed.author, lang: parsed.lang,
    added: Date.now(), opened: 0, pos: (text.chapters.find(c => c.body) || { start: 0 }).start, count: text.words.length,
    left: est.msPerWord(0) * text.words.length, ...extra,
  };
  await db.putText({ id, ...text });
  await db.putBook(book);
  return book;
}

async function importFile(file) {
  const buf = await file.arrayBuffer();
  const parsed = await parseEpub(buf);
  return importParsed(parsed);
}

async function fetchSample(name) {
  try {
    const r = await fetch(SAMPLES[name]);
    if (r.ok && !/text\/html/.test(r.headers.get('content-type') || '')) return await r.arrayBuffer();
  } catch {}
  // Hosts that won't serve .epub get a base64 copy (see tools/make_artifact.py)
  const r = await fetch(SAMPLES[name].replace(/\.epub$/, '.b64.txt'));
  if (!r.ok) throw new Error('Sample could not be loaded');
  const bin = atob((await r.text()).trim());
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return bytes.buffer;
}

async function importSample(name) {
  const parsed = await parseEpub(await fetchSample(name));
  return importParsed(parsed, { sample: name });
}

$('#file-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    toast(`Adding ${f.name}…`, 60000);
    try {
      const b = await importFile(f);
      toast(`Added ${b.title}`);
    } catch (err) {
      console.error(err);
      toast(`${f.name}: ${err instanceof EpubError ? err.message : 'could not be opened'}`, 5000);
    }
  }
  refreshLibrary();
});

document.querySelectorAll('[data-sample]').forEach(b => b.addEventListener('click', async () => {
  toast('Adding sample…', 60000);
  try { const book = await importSample(b.dataset.sample); toast(`Added ${book.title}`); }
  catch (err) { console.error(err); toast(err.message, 4000); }
  refreshLibrary();
}));

$('#open-paste').addEventListener('click', () => { showSheet('#sheet-paste'); });
$('#paste-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const b = await importParsed(parsePlainText($('#paste-title').value, $('#paste-text').value));
    $('#paste-title').value = ''; $('#paste-text').value = '';
    closeSheet();
    toast(`Added ${b.title}`);
    refreshLibrary();
  } catch (err) { toast(err.message, 4000); }
});

// ---------- reader ----------
const stage = $('#stage');
const wordEl = $('#word');
const [L, P, R] = wordEl.children;
let focusFrac = 0.38;

function measureFocus() {
  focusFrac = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--focus-x')) / 100 || 0.38;
}

function chapterAt(i) {
  const ch = cur.text.chapters;
  let lo = 0, hi = ch.length - 1, ans = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ch[mid].start <= i) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

function renderWord(i) {
  const ja = cur.book.lang === 'ja';
  const chars = Array.from(cur.text.words[i]);
  const pi = pivotIndex(cur.text.words[i], ja);
  L.textContent = chars.slice(0, pi).join('');
  P.textContent = chars[pi] || '';
  R.textContent = chars.slice(pi + 1).join('');
  placeWord();
}

function placeWord() {
  const W = stage.clientWidth;
  const X = W * focusFrac;
  const lw = L.offsetWidth, pw = P.offsetWidth, rw = R.offsetWidth;
  const needL = lw + pw / 2, needR = rw + pw / 2;
  const scale = Math.min(1, (X - 4) / Math.max(needL, 1), (W - X - 4) / Math.max(needR, 1));
  wordEl.style.transformOrigin = `${needL}px 50%`;
  wordEl.style.transform = `translateX(${X - needL}px) scale(${scale})`;
}

let lastUi = 0;
function onWord(i) {
  renderWord(i);
  const now = performance.now();
  if (!cur.player.playing || now - lastUi > 400) { lastUi = now; updateProgress(); }
  if (!cur.player.playing) renderContext();
}

let estCache = { at: -1e9, ms: 0, speed: 0 };
function updateProgress() {
  const { player, text, book } = cur;
  const i = player.i, n = player.n;
  $('#scrub').value = n > 1 ? Math.round(i / (n - 1) * 1000) : 0;
  const c = chapterAt(i);
  if (c !== cur.chapter) {
    cur.chapter = c;
    $('#rd-chapter').textContent = text.chapters[c] ? text.chapters[c].title : '';
  }
  const pct = n > 1 ? i / (n - 1) : 0;
  $('#pct').textContent = `${(pct * 100).toFixed(pct < 0.1 ? 1 : 0)}%`;
  if (Math.abs(i - estCache.at) > 200 || estCache.speed !== player.speed) {
    estCache = { at: i, ms: player.msPerWord(i), speed: player.speed };
  }
  const chEnd = text.chapters[c + 1] ? text.chapters[c + 1].start : n;
  const msw = estCache.ms;
  $('#left').textContent = `${fmtTime((chEnd - i) * msw)} in chapter · ${fmtTime((n - i) * msw)} in book`;
  book.left = (n - i) * msw;
}

function renderSpeed() {
  const ja = cur && cur.book.lang === 'ja';
  $('#speed-val').textContent = ja ? settings.cpm : settings.wpm;
  $('#speed-unit').textContent = ja ? 'characters/min' : 'words/min';
}

function changeSpeed(dir) {
  const ja = cur.book.lang === 'ja';
  if (ja) settings.cpm = Math.max(100, Math.min(2000, settings.cpm + dir * 25));
  else settings.wpm = Math.max(100, Math.min(1200, settings.wpm + dir * 25));
  saveSettings();
  renderSpeed();
  updateProgress();
}

function sentenceRange(k) {
  const { words, para, off, paras } = cur.text;
  const p = para[k];
  let a = k; while (a > 0 && para[a - 1] === p && !isSentenceEnd(words[a - 1])) a--;
  let b = k; while (b < words.length - 1 && para[b + 1] === p && !isSentenceEnd(words[b])) b++;
  const end = b + 1 < words.length && para[b + 1] === p ? off[b + 1] : paras[p].length;
  return paras[p].slice(off[a], end).trim();
}

function renderContext() {
  const ctx = $('#context');
  if (!cur || cur.player.playing || !settings.context) { ctx.hidden = true; return; }
  const { paras, paraStart, off, para } = cur.text;
  const i = cur.player.i;
  const p = para[i];
  // two paragraphs before, then enough after to fill the box
  const from = Math.max(0, p - 2);
  let to = p, chars = 0;
  while (to < paras.length - 1 && (to - p < 2 || chars < 500) && to - p < 8) { to++; chars += paras[to].length; }
  const frag = document.createDocumentFragment();
  let curSpan = null;
  for (let q = from; q <= to; q++) {
    const pe = el('p', Math.abs(q - p) <= 0 ? 'near' : 'far');
    const first = paraStart[q];
    const last = q + 1 < paraStart.length ? paraStart[q + 1] - 1 : cur.player.n - 1;
    const text = paras[q];
    if (off[first] > 0) pe.append(text.slice(0, off[first]));
    for (let k = first; k <= last; k++) {
      const end = k < last ? off[k + 1] : text.length;
      const s = el('span', k === i ? 'tk cur' : 'tk', text.slice(off[k], end));
      s.dataset.i = k;
      if (k === i) curSpan = s;
      pe.append(s);
    }
    frag.append(pe);
  }
  ctx.textContent = '';
  ctx.append(frag);
  ctx.hidden = false;
  if (curSpan) {
    const top = curSpan.offsetTop - ctx.offsetTop;
    ctx.scrollTop = Math.max(0, top - ctx.clientHeight / 2 + curSpan.offsetHeight / 2);
  }
}

function onState(playing, why) {
  stage.classList.toggle('playing', playing);
  const btn = $('#play');
  btn.innerHTML = `<svg><use href="#i-${playing ? 'pause' : 'play'}"/></svg>`;
  btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('#stage-hint').textContent = 'Tap to read';
  if (playing) { lockScreen(); $('#context').hidden = true; }
  else {
    releaseScreen();
    updateProgress();
    renderContext();
    savePosition();
  }
  if (why === 'end') { $('#stage-hint').textContent = 'The end'; toast('Finished the book'); }
}

async function lockScreen() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { wakeLock = null; }
}
function releaseScreen() { try { if (wakeLock) wakeLock.release(); } catch {} wakeLock = null; }

let saveTimer = 0;
async function savePosition() {
  if (!cur) return;
  cur.book.pos = cur.player.i;
  cur.book.opened = Date.now();
  try { await db.putBook(cur.book); } catch (e) { console.warn(e); }
}

async function openBook(id) {
  const [book, stored] = await Promise.all([db.getBook(id), db.getText(id)]);
  if (!book || !stored) { toast('This book could not be loaded'); refreshLibrary(); return; }
  let text = stored;
  if (book.lang === 'ja' && stored.v !== TOKENIZER_VERSION) {
    // split with the current word rules, keeping the reading spot
    const r = retokenize(stored, book.lang, book.pos || 0);
    text = { id, ...r.text };
    book.pos = r.pos;
    book.count = text.words.length;
    try { await db.putText(text); await db.putBook(book); } catch (e) { console.warn(e); }
  }
  const player = new Player({ text, lang: book.lang, settings, onWord, onState });
  cur = { book, text, player, chapter: -1 };
  $('#library').hidden = true;
  $('#reader').hidden = false;
  $('#rd-book').textContent = book.title;
  document.documentElement.lang = book.lang === 'ja' ? 'ja' : 'en';
  wordEl.lang = book.lang;
  $('#context').lang = book.lang;
  measureFocus();
  renderSpeed();
  estCache = { at: -1e9, ms: 0, speed: 0 };
  player.seek(Math.min(book.pos || 0, player.n - 1));
  onState(false);
  clearInterval(saveTimer);
  saveTimer = setInterval(() => { if (cur && cur.player.playing) savePosition(); }, 5000);
  stage.focus({ preventScroll: true });
}

async function closeBook() {
  if (!cur) return;
  cur.player.pause();
  await savePosition();
  clearInterval(saveTimer);
  cur = null;
  $('#reader').hidden = true;
  $('#library').hidden = false;
  document.documentElement.lang = 'en';
  refreshLibrary();
}

// stage: tap = play/pause, swipe = sentence back/forward
let down = null;
stage.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
stage.addEventListener('pointerup', (e) => {
  if (!down || !cur) return;
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  down = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { dx < 0 ? cur.player.forward() : cur.player.back(); return; }
  if (Math.abs(dx) < 12 && Math.abs(dy) < 12) cur.player.toggle();
});
stage.addEventListener('keydown', (e) => { if (e.key === 'Enter') cur && cur.player.toggle(); });

$('#play').addEventListener('click', () => cur && cur.player.toggle());
$('#prev').addEventListener('click', () => cur && cur.player.back());
$('#next').addEventListener('click', () => cur && cur.player.forward());
$('#speed-up').addEventListener('click', () => cur && changeSpeed(1));
$('#speed-down').addEventListener('click', () => cur && changeSpeed(-1));
$('#rd-back').addEventListener('click', closeBook);

const scrub = $('#scrub');
scrub.addEventListener('input', () => {
  if (!cur) return;
  cur.player.pause();
  cur.player.seek(Math.round(scrub.value / 1000 * (cur.player.n - 1)));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openSheet) { closeSheet(); return; }
  if (!cur || openSheet || /INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName) && document.activeElement.type !== 'range') return;
  if (e.key === ' ') { e.preventDefault(); cur.player.toggle(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); cur.player.back(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); cur.player.forward(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); changeSpeed(1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); changeSpeed(-1); }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && cur) { cur.player.pause(); savePosition(); }
});
window.addEventListener('pagehide', () => { if (cur) savePosition(); });
window.addEventListener('resize', () => { measureFocus(); if (cur) placeWord(); });

// ---------- chapters ----------
$('#rd-toc').addEventListener('click', () => {
  if (!cur) return;
  cur.player.pause();
  const list = $('#toc-list');
  list.textContent = '';
  const { chapters } = cur.text;
  const c = chapterAt(cur.player.i);
  chapters.forEach((ch, k) => {
    const li = el('li', k === c ? 'cur' : '');
    const b = el('button');
    b.append(el('span', '', ch.title));
    b.append(el('span', 'pct', `${Math.round(ch.start / Math.max(1, cur.player.n - 1) * 100)}%`));
    b.addEventListener('click', () => { cur.player.seek(ch.start); closeSheet(); renderContext(); });
    li.append(b);
    list.append(li);
  });
  showSheet('#sheet-toc');
  const active = list.querySelector('.cur');
  if (active) active.scrollIntoView({ block: 'center' });
});

// ---------- settings ----------
function openSettings() {
  if (cur) cur.player.pause();
  $('#set-size').value = settings.size;
  $('#set-smart').checked = settings.smart;
  $('#set-ramp').checked = settings.ramp;
  $('#set-context').checked = settings.context;
  applyTheme();
  showSheet('#sheet-settings');
}
$('#rd-settings').addEventListener('click', openSettings);
$('#open-settings-lib').addEventListener('click', openSettings);
$('#set-size').addEventListener('input', (e) => { settings.size = +e.target.value; applyTheme(); saveSettings(); if (cur) placeWord(); });
$('#set-smart').addEventListener('change', (e) => { settings.smart = e.target.checked; saveSettings(); if (cur) { estCache.at = -1e9; updateProgress(); } });
$('#set-ramp').addEventListener('change', (e) => { settings.ramp = e.target.checked; saveSettings(); });
$('#set-context').addEventListener('change', (e) => { settings.context = e.target.checked; saveSettings(); renderContext(); });
document.querySelectorAll('[data-theme-opt]').forEach(b => b.addEventListener('click', () => { settings.theme = b.dataset.themeOpt; saveSettings(); applyTheme(); }));

// ---------- lookup ----------
function charIndexAt(node, off, x, y) {
  for (const o of [off - 1, off]) {
    if (o < 0 || o >= node.length) continue;
    const rg = document.createRange();
    rg.setStart(node, o); rg.setEnd(node, o + 1);
    for (const rc of rg.getClientRects()) {
      if (x >= rc.left - 1 && x <= rc.right + 1 && y >= rc.top - 2 && y <= rc.bottom + 2) return o;
    }
  }
  return Math.max(0, Math.min(off, node.length - 1));
}

$('#context').addEventListener('click', (e) => {
  if (!cur) return;
  const sel = window.getSelection && window.getSelection();
  if (sel && !sel.isCollapsed) return; // user is selecting text (iPhone Look Up)
  const span = e.target.closest('.tk');
  if (!span) return;
  const k = +span.dataset.i;
  let charOff = 0;
  const node = span.firstChild;
  let r = null;
  if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(e.clientX, e.clientY);
  else if (document.caretPositionFromPoint) { const cp = document.caretPositionFromPoint(e.clientX, e.clientY); if (cp) r = { startContainer: cp.offsetNode, startOffset: cp.offset }; }
  if (r && node && r.startContainer === node) charOff = charIndexAt(node, r.startOffset, e.clientX, e.clientY);
  openLookup(k, charOff);
});

let lookupState = null;
async function openLookup(k, charOff) {
  const { words, para, off, paras } = cur.text;
  const ja = cur.book.lang === 'ja';
  const sentence = sentenceRange(k);
  const body = $('#lk-body');
  body.textContent = '';
  const save = $('#lk-save');
  save.disabled = false;
  save.innerHTML = '<svg><use href="#i-star"/></svg>Save word';
  $('#lk-jump').onclick = () => { cur.player.seek(k); closeSheet(); renderContext(); };
  if (!ja) {
    const word = words[k].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || words[k];
    $('#lk-head').textContent = word;
    body.append(el('p', 'lk-sentence', sentence));
    lookupState = { word, reading: '', meaning: '', sentence };
    showSheet('#sheet-lookup');
    return;
  }
  const p = para[k];
  const start = off[k] + charOff;
  const src = paras[p].slice(start, start + 16);
  $('#lk-head').textContent = Array.from(src).slice(0, 1).join('') + '…';
  body.append(el('p', 'lk-form', 'Looking up…'));
  showSheet('#sheet-lookup');
  lookupState = null;
  let results;
  try { results = await lookup(src); }
  catch (e) {
    console.warn(e);
    body.textContent = '';
    body.append(el('p', 'lk-form', 'The dictionary could not be loaded. Open this word once while online and it will work offline after that.'));
    $('#lk-head').textContent = src.slice(0, 4);
    lookupState = { word: src.slice(0, 4), reading: '', meaning: '', sentence };
    return;
  }
  body.textContent = '';
  if (!results.length) {
    $('#lk-head').textContent = Array.from(src)[0];
    body.append(el('p', 'lk-form', 'No dictionary entry.'));
    body.append(el('p', 'lk-sentence', sentence));
    lookupState = { word: Array.from(src)[0], reading: '', meaning: '', sentence };
    return;
  }
  $('#lk-head').textContent = results[0].matched;
  for (const r of results) {
    const box = el('div', 'lk-entry');
    const w = el('div', 'lk-word', headword(r));
    const rd = reading(r);
    if (rd) w.append(el('span', 'lk-reading', rd));
    if (r.common) w.append(el('span', 'common', 'COMMON'));
    box.append(w);
    const why = r.why.filter(x => x !== 'stem' && x !== 'suru verb');
    if (why.length) box.append(el('div', 'lk-form', `${r.matched} · ${why.slice().reverse().join(', ')}`));
    const ol = el('ol', 'lk-senses');
    for (const [pos, gloss] of r.senses) {
      const li = el('li');
      if (pos) li.append(el('span', 'lk-pos', pos));
      li.append(gloss);
      ol.append(li);
    }
    box.append(ol);
    body.append(box);
  }
  body.append(el('p', 'lk-sentence', sentence));
  const top = results[0];
  lookupState = {
    word: headword(top), reading: reading(top),
    meaning: top.senses.slice(0, 3).map(s => s[1]).join('; '), sentence,
  };
}

$('#lk-save').addEventListener('click', async () => {
  if (!lookupState || !cur) return;
  await db.putWord({ id: db.newId(), ...lookupState, book: cur.book.title, lang: cur.book.lang, added: Date.now() });
  const save = $('#lk-save');
  save.textContent = 'Saved';
  save.disabled = true;
  refreshWordCount();
});

// ---------- saved words ----------
async function refreshWordCount() {
  const words = await db.allWords();
  const c = $('#words-count');
  c.textContent = words.length;
  c.hidden = !words.length;
  return words;
}

let savedWords = [];
async function renderWords() {
  const words = await refreshWordCount();
  savedWords = words;
  const list = $('#words-list');
  list.textContent = '';
  for (const w of words) {
    const li = el('li');
    const head = el('div', 'w-head', w.word);
    if (w.reading) head.append(el('span', 'w-read', w.reading));
    li.append(head);
    if (w.meaning) li.append(el('div', 'w-mean', w.meaning));
    if (w.sentence) li.append(el('div', 'w-sent', w.sentence));
    const del = el('button', 'icon-btn');
    del.setAttribute('aria-label', `Remove ${w.word}`);
    del.innerHTML = '<svg><use href="#i-close"/></svg>';
    del.addEventListener('click', async () => { await db.deleteWord(w.id); renderWords(); });
    li.append(del);
    list.append(li);
  }
  $('#words-empty').hidden = words.length > 0;
  $('#words-copy').disabled = !words.length;
  return words;
}

function wordsTsv(words) {
  const clean = (s) => String(s || '').replace(/[\t\r\n]+/g, ' ');
  return words.map(w => [w.word, w.reading, w.meaning, w.sentence, w.book].map(clean).join('\t')).join('\n');
}

$('#open-words').addEventListener('click', async () => {
  await renderWords();
  const shareBtn = $('#words-share');
  shareBtn.hidden = !(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] }));
  showSheet('#sheet-words');
});

// Safari only allows clipboard and share inside the tap itself, so use the list already loaded.
$('#words-copy').addEventListener('click', async () => {
  const words = savedWords;
  const tsv = wordsTsv(words);
  try {
    await navigator.clipboard.writeText(tsv);
    toast(`Copied ${words.length} words. In Anki: File › Import, tab-separated.`, 4000);
  } catch {
    const ta = el('textarea');
    ta.value = tsv;
    ta.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:40%;z-index:50';
    document.body.append(ta);
    ta.select();
    toast('Select all and copy', 3000);
    setTimeout(() => ta.remove(), 15000);
  }
});

$('#words-share').addEventListener('click', async () => {
  const file = new File([wordsTsv(savedWords)], 'speed-reader-words.txt', { type: 'text/plain' });
  try { await navigator.share({ files: [file], title: 'Saved words' }); } catch {}
});

// ---------- start ----------
async function start() {
  applyTheme();
  $('#app-version').textContent = `Version ${APP_VERSION}.`;
  db.persist();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch {}
  }
  await refreshLibrary();
  if (!books.length && !db.flag('seeded')) {
    db.flag('seeded', '1');
    try {
      await importSample('sherlock-holmes');
      await importSample('kumo-no-ito');
    } catch (e) { console.warn('samples', e); }
    await refreshLibrary();
  }
  if (await db.isMemoryOnly()) toast('This browser blocks storage, so books are kept only until you close the page.', 6000);
}

start();
