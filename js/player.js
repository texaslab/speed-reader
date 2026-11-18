// Timing engine: decides how long each word stays on screen and steps through the book.

import { isSentenceEnd } from './tokenize.js';

const KANJI = /[㐀-鿿豈-﫿々]/g;
const LETTER = /[\p{L}\p{N}]/gu;
const RAMP = 6;

export class Player {
  constructor({ text, lang, settings, onWord, onState }) {
    this.t = text;
    this.ja = lang === 'ja';
    this.s = settings;
    this.onWord = onWord;
    this.onState = onState;
    this.i = 0;
    this.playing = false;
    this.timer = 0;
    this.rampLeft = 0;
    this.n = text.words.length;
  }

  get speed() { return this.ja ? this.s.cpm : this.s.wpm; }

  // milliseconds for word i
  delay(i, smart = this.s.smart) {
    const w = this.t.words[i];
    const paraEnd = i + 1 >= this.n || this.t.para[i + 1] !== this.t.para[i];
    let ms;
    if (this.ja) {
      const perChar = 60000 / this.s.cpm;
      const letters = (w.match(LETTER) || []).length;
      const kanji = (w.match(KANJI) || []).length;
      let units = Math.max(letters + (smart ? kanji * 0.5 : 0), 2);
      if (smart) {
        if (/[。！？!?…]["」』）)]*$/.test(w)) units += 4;
        else if (/[、，,]$/.test(w)) units += 2;
        else if (/[」』）)]$/.test(w)) units += 1.5;
        if (paraEnd) units += 3;
      }
      ms = units * perChar;
    } else {
      const base = 60000 / this.s.wpm;
      let f = 1;
      if (smart) {
        const len = (w.match(LETTER) || []).length;
        if (len > 7) f += Math.min(0.6, (len - 7) * 0.08);
        if (/\d/.test(w)) f += 0.3;
        if (isSentenceEnd(w)) f += 1.3;
        else if (/[,;:—–)]["'”’]*$/.test(w)) f += 0.6;
        if (paraEnd) f += 1.0;
      }
      ms = base * f;
    }
    if (this.rampLeft > 0) ms *= 1 + 0.12 * this.rampLeft;
    return ms;
  }

  show() { this.onWord(this.i); }

  play() {
    if (this.playing) return;
    if (this.i >= this.n - 1) this.i = 0;
    this.playing = true;
    this.rampLeft = this.s.ramp ? RAMP : 0;
    this.onState(true);
    this.show();
    this.next = performance.now() + this.delay(this.i);
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    const wait = Math.max(0, this.next - performance.now());
    this.timer = setTimeout(() => this.tick(), wait);
  }

  tick() {
    if (!this.playing) return;
    if (this.i >= this.n - 1) { this.pause(); this.onState(false, 'end'); return; }
    this.i++;
    if (this.rampLeft > 0) this.rampLeft--;
    this.show();
    const now = performance.now();
    // keep rhythm, but don't try to catch up after a stall (tab in background)
    this.next = Math.max(this.next, now - 50) + this.delay(this.i);
    this.schedule();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    clearTimeout(this.timer);
    this.onState(false);
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  seek(i) {
    this.i = Math.max(0, Math.min(this.n - 1, i | 0));
    if (this.playing) { this.rampLeft = this.s.ramp ? RAMP : 0; this.next = performance.now() + this.delay(this.i); this.schedule(); }
    this.show();
  }

  sentenceStart(i) {
    let j = i;
    while (j > 0 && !isSentenceEnd(this.t.words[j - 1]) && this.t.para[j - 1] === this.t.para[i]) j--;
    return j;
  }

  back() {
    const start = this.sentenceStart(this.i);
    this.seek(this.i - start <= 1 && start > 0 ? this.sentenceStart(start - 1) : start);
  }

  forward() {
    let j = this.i;
    while (j < this.n - 1 && !isSentenceEnd(this.t.words[j]) && this.t.para[j + 1] === this.t.para[j]) j++;
    this.seek(Math.min(this.n - 1, j + 1));
  }

  // average ms per word near here, for time-left estimates
  msPerWord(from = this.i) {
    const end = Math.min(this.n, from + 1500);
    if (end <= from) return 0;
    let total = 0;
    const saved = this.rampLeft; this.rampLeft = 0;
    for (let k = from; k < end; k++) total += this.delay(k);
    this.rampLeft = saved;
    return total / (end - from);
  }
}
