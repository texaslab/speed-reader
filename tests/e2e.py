"""End-to-end check in WebKit (Safari's engine) at iPhone size.

Usage: python3 -I tests/e2e.py <base url> <screenshot dir>
Serve the repo first, e.g. python3 -m http.server 8765 --directory <repo>.
Exits non-zero on the first failed check.
"""
import sys
import time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/') + '/'
OUT = sys.argv[2]
REPO_SAMPLE = sys.argv[3] if len(sys.argv) > 3 else None
errors = []
checks = []


def check(name, ok, detail=''):
    checks.append((name, ok, detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))
    if not ok:
        raise SystemExit(1)


def shot(page, name):
    page.screenshot(path=f'{OUT}/{name}.png')


with sync_playwright() as p:
    browser = p.webkit.launch()
    device = p.devices['iPhone 13']
    for scheme in ['dark', 'light']:
        ctx = browser.new_context(**device, color_scheme=scheme, service_workers='allow')
        page = ctx.new_page()
        page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE)
        page.wait_for_function("document.querySelectorAll('#books .book').length >= 2", timeout=30000)
        titles = page.eval_on_selector_all('#books .book-title', 'els => els.map(e => e.textContent)')
        check(f'[{scheme}] samples imported on first run', len(titles) == 2, ', '.join(titles))
        shot(page, f'{scheme}-01-library')
        if scheme == 'light':
            ctx.close()
            continue

        # English book
        page.click('#books .book-open >> text=Sherlock')
        page.wait_for_selector('#reader:not([hidden])')
        page.wait_for_selector('#context:not([hidden]) .tk.cur')
        first = page.inner_text('#word')
        check('book opens at chapter one', page.inner_text('#rd-chapter') == 'A Scandal in Bohemia', page.inner_text('#rd-chapter'))
        shot(page, f'{scheme}-02-reader-paused')
        pivot_ok = page.evaluate("""() => {
          const p = document.querySelector('#word .p').getBoundingClientRect();
          const st = document.querySelector('#stage').getBoundingClientRect();
          const x = st.left + st.width * 0.38;
          return Math.abs((p.left + p.width / 2) - x);
        }""")
        check('red letter sits on the focus line', pivot_ok < 3, f'{pivot_ok:.1f}px off')
        page.click('#play')
        time.sleep(2.5)
        mid = page.inner_text('#word')
        shot(page, f'{scheme}-03-reader-playing')
        page.click('#play')
        pos = page.evaluate("() => +document.querySelector('#scrub').value")
        check('playing advances words', mid != first, f'{first!r} -> {mid!r}')
        page.wait_for_selector('#context:not([hidden])')
        # speed up
        before = page.inner_text('#speed-val')
        page.click('#speed-up')
        after = page.inner_text('#speed-val')
        check('speed button changes speed', int(after) == int(before) + 25, f'{before} -> {after}')
        # back a sentence
        w1 = page.evaluate("() => document.querySelector('#context .tk.cur').dataset.i")
        page.click('#prev')
        w2 = page.evaluate("() => document.querySelector('#context .tk.cur').dataset.i")
        check('back one sentence moves back', int(w2) < int(w1), f'{w1} -> {w2}')
        # lookup on an English word
        page.click('#context .tk.cur')
        page.wait_for_selector('#sheet-lookup:not([hidden])')
        shot(page, f'{scheme}-04-lookup-en')
        page.click('#lk-save')
        check('save word', page.inner_text('#lk-save') == 'Saved')
        page.click('#sheet-lookup [data-close]')
        # chapters
        page.click('#rd-toc')
        page.wait_for_selector('#sheet-toc:not([hidden])')
        n_ch = page.eval_on_selector_all('#toc-list li', 'els => els.length')
        check('chapter list', n_ch >= 12, f'{n_ch} chapters')
        shot(page, f'{scheme}-05-chapters')
        page.click('#toc-list li:nth-child(4) button')
        chap = page.inner_text('#rd-chapter')
        check('jump to chapter', bool(chap), chap)
        page.click('#rd-back')
        page.wait_for_selector('#library:not([hidden])')

        # Japanese book
        page.click('#books .book-open >> text=蜘蛛の糸')
        page.wait_for_selector('#context:not([hidden]) .tk.cur')
        page.click('#rd-toc')
        page.click('#toc-list li:nth-child(2) button')
        ctx_text = page.inner_text('#context')
        check('furigana not doubled', 'おしゃかさま' not in ctx_text and '御釈迦様' in ctx_text, ctx_text[:60])
        unit = page.inner_text('#speed-unit')
        check('Japanese speed in characters', 'characters' in unit, unit)
        shot(page, f'{scheme}-06-ja-paused')
        page.click('#play')
        time.sleep(2)
        shot(page, f'{scheme}-07-ja-playing')
        page.click('#play')
        page.wait_for_selector('#context:not([hidden])')
        # tap 御釈迦様
        box = page.evaluate("""() => {
          const ctx = document.querySelector('#context');
          for (const s of ctx.querySelectorAll('.tk')) {
            const n = s.firstChild; const i = n.data.indexOf('釈迦');
            if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
              const b = r.getBoundingClientRect(); s.scrollIntoView({block:'center'});
              const b2 = r.getBoundingClientRect(); return [b2.left + b2.width / 2, b2.top + b2.height / 2]; }
          }
          return null;
        }""")
        check('found 釈迦 in context', box is not None)
        page.mouse.click(box[0], box[1])
        page.wait_for_selector('#sheet-lookup:not([hidden]) .lk-entry', timeout=20000)
        head = page.inner_text('#lk-head')
        first_entry = page.inner_text('#lk-body .lk-entry')
        check('Japanese lookup', '釈迦' in head and len(first_entry) > 5, f'{head}: {first_entry[:60]!r}')
        shot(page, f'{scheme}-08-lookup-ja')
        page.click('#lk-save')
        page.click('#sheet-lookup [data-close]')
        page.click('#rd-back')

        # saved words
        page.click('#open-words')
        page.wait_for_selector('#sheet-words:not([hidden])')
        n_words = page.eval_on_selector_all('#words-list li', 'els => els.length')
        check('saved words list', n_words == 2, str(n_words))
        shot(page, f'{scheme}-09-words')
        page.click('#sheet-words [data-close]')

        # persistence
        page.reload()
        page.wait_for_function("document.querySelectorAll('#books .book').length >= 2")
        meta = page.inner_text('#books .book >> nth=0')
        check('library survives reload', 'Sherlock' in meta or '蜘蛛' in meta, meta.replace('\n', ' | '))

        # upload an epub
        if REPO_SAMPLE:
            page.set_input_files('#file-input', REPO_SAMPLE)
            page.wait_for_function("document.querySelectorAll('#books .book').length >= 3", timeout=30000)
            check('upload epub', True)

        # paste text
        page.click('#open-paste')
        page.fill('#paste-title', 'Pasted')
        page.fill('#paste-text', 'First paragraph here. It has two sentences.\n\nSecond paragraph.')
        page.click('#paste-form button[type=submit]')
        page.wait_for_function("[...document.querySelectorAll('#books .book-title')].some(e => e.textContent === 'Pasted')")
        check('paste text', True)

        ctx.close()
    browser.close()

    # Offline: Playwright's WebKit can't navigate offline, so this part runs in Chromium.
    browser = p.chromium.launch()
    ctx = browser.new_context(**p.devices['Pixel 7'], service_workers='allow')
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.wait_for_function("document.querySelectorAll('#books .book').length >= 2", timeout=30000)
    page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller !== null", timeout=15000)
    ctx.set_offline(True)
    page.goto(BASE)
    page.wait_for_function("document.querySelectorAll('#books .book').length >= 2", timeout=15000)
    page.click('#books .book-open >> text=蜘蛛の糸')
    page.wait_for_selector('#context:not([hidden]) .tk')
    check('works offline after first visit', True)
    ctx.close()
    browser.close()

real_errors = [e for e in errors if 'serviceWorker' not in e]
print('console errors:', real_errors or 'none')
if real_errors:
    raise SystemExit(1)
print(f'{len(checks)} checks passed')
