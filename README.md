# Speed Reader

Reads epubs one word at a time in a fixed spot (RSVP), with the focus letter in red, so your eyes never move.
English and Japanese. Runs in Safari on iPhone as a home-screen app. No account, no server, no cost.

## What it does
- Add `.epub` files (from Files / iCloud Drive) or paste text. Books without copy protection only.
- Tap the word to play or pause. Swipe left or right, or use the arrows, to jump a sentence.
- Smart pacing: longer words, commas, sentence and paragraph ends stay on screen a bit longer.
  Japanese speed is in characters per minute; kanji count a little extra.
- Eases in for the first few words after a pause.
- When paused, the surrounding text shows with the current word marked. Tap a word there to look it up
  (Japanese, offline dictionary with conjugations undone: 食べなかった → 食べる) or to read from that point.
- Save words; copy them as tab-separated lines for Anki (word, reading, meaning, sentence, book).
- Chapters list, progress bar, time left in the chapter and the book.
- Remembers your place per book. Works offline once opened.

## Run locally
    python3 -m http.server 8791 --directory .
Open http://localhost:8791.

## Test
    python3 -I tests/e2e.py http://localhost:8791/ <screenshot folder> samples/kumo-no-ito.epub
Runs in WebKit (Safari's engine) at iPhone size, plus an offline check in Chromium.

## Files
- `index.html`, `css/app.css`, `js/` — the app (no build step).
  - `epub.js` reads the epub (drops furigana `<rt>` so readings are not doubled),
    `tokenize.js` splits text into display units, `player.js` timing,
    `dict.js` + `deinflect.js` Japanese lookup, `store.js` IndexedDB, `app.js` the screens.
- `sw.js`, `manifest.webmanifest`, `icons/` — home-screen app and offline cache.
- `dict/` — JMdict in 64 pieces, loaded only when you look something up. Rebuild with
  `python3 -I tools/build_dict.py <jmdict-eng-*.json> dict` from https://github.com/scriptin/jmdict-simplified/releases.
- `samples/` — two public-domain books added on first run.
- `tools/make_artifact.py` — copies the app into `build/artifact/` for hosting as a Claude page.

## Credits
Japanese dictionary: JMdict, Electronic Dictionary Research and Development Group, CC BY-SA 4.0.
See LICENSE for the rest.
