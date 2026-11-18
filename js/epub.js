// Turn an .epub (ArrayBuffer) into plain paragraphs per chapter.
// Furigana (<rt>, <rp>) is dropped so readings don't appear twice.

const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'SECTION', 'ARTICLE',
  'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'TABLE', 'TR', 'TD', 'TH', 'DT', 'DD', 'DL', 'UL', 'OL',
  'PRE', 'ADDRESS', 'HR', 'MAIN', 'HGROUP', 'CAPTION', 'TBODY', 'THEAD', 'TFOOT', 'BODY']);
const SKIP = new Set(['RT', 'RP', 'SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'svg', 'SVG', 'MATH', 'math', 'NOSCRIPT', 'IMG', 'AUDIO', 'VIDEO']);
const CJK = /[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/;

export class EpubError extends Error {}

function dirOf(path) { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i + 1); }
function resolve(base, href) {
  const parts = (dirOf(base) + href).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}
function stripHash(h) { const i = h.indexOf('#'); return i < 0 ? h : h.slice(0, i); }
function decode(h) { try { return decodeURIComponent(h); } catch { return h; } }

function zipFile(zip, path) {
  return zip.file(path) || zip.file(decode(path)) ||
    Object.values(zip.files).find(f => f.name.toLowerCase() === path.toLowerCase()) || null;
}

async function readText(zip, path) {
  const f = zipFile(zip, path);
  if (!f) throw new EpubError(`Missing ${path} inside the epub`);
  return f.async('string');
}

function parseXml(text, type = 'application/xml') {
  const doc = new DOMParser().parseFromString(text, type);
  if (doc.getElementsByTagName('parsererror').length) return null;
  return doc;
}

function parseXhtml(text) {
  return parseXml(text, 'application/xhtml+xml') || new DOMParser().parseFromString(text, 'text/html');
}

function byLocal(root, name) {
  return Array.from(root.getElementsByTagNameNS('*', name));
}

function firstText(root, name) {
  const el = byLocal(root, name)[0];
  return el ? el.textContent.trim() : '';
}

function norm(s) {
  return s.replace(/[\s ]+/g, ' ').trim();
}

function normPara(s, ja) {
  let t = norm(s).replace(/^[　\s]+/, '').replace(/[　\s]+$/, '');
  if (ja) t = t.replace(/([^\x00-\x7f]) (?=[^\x00-\x7f])/g, '$1');
  return t;
}

// Walk the body and collect text blocks in reading order.
function blocks(body) {
  const out = [];
  let run = '';
  const flush = () => { if (run.trim()) out.push(run); run = ''; };
  const walk = (node) => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { run += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.localName ? n.localName.toUpperCase() : n.nodeName.toUpperCase();
      if (SKIP.has(tag) || SKIP.has(n.localName)) continue;
      const type = n.getAttributeNS && (n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || n.getAttribute('epub:type') || '');
      if (type && /\b(pagebreak|noteref|footnote|endnote|rearnote)\b/.test(type)) continue;
      if (tag === 'BR') { run += ' '; continue; }
      if (BLOCK.has(tag)) { flush(); walk(n); flush(); }
      else walk(n);
    }
  };
  walk(body);
  flush();
  return out;
}

async function tocMap(zip, opfPath, opf, manifest) {
  const map = new Map();
  const navItem = Object.values(manifest).find(it => /\bnav\b/.test(it.props));
  try {
    if (navItem) {
      const doc = parseXhtml(await readText(zip, navItem.path));
      const navs = byLocal(doc, 'nav');
      const nav = navs.find(n => /toc/.test(n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || n.getAttribute('epub:type') || '')) || navs[0];
      if (nav) {
        for (const a of byLocal(nav, 'a')) {
          const href = a.getAttribute('href');
          if (!href) continue;
          const key = resolve(navItem.path, decode(stripHash(href)));
          const label = norm(a.textContent);
          if (label && !map.has(key)) map.set(key, label);
        }
      }
    }
    if (!map.size) {
      const spine = byLocal(opf, 'spine')[0];
      const tocId = spine && spine.getAttribute('toc');
      const ncx = (tocId && manifest[tocId]) || Object.values(manifest).find(it => it.type === 'application/x-dtbncx+xml');
      if (ncx) {
        const doc = parseXml(await readText(zip, ncx.path));
        if (doc) {
          for (const np of byLocal(doc, 'navPoint')) {
            const content = byLocal(np, 'content')[0];
            const label = byLocal(np, 'text')[0];
            if (!content || !label) continue;
            const key = resolve(ncx.path, decode(stripHash(content.getAttribute('src') || '')));
            const text = norm(label.textContent);
            if (text && !map.has(key)) map.set(key, text);
          }
        }
      }
    }
  } catch (e) { console.warn('toc', e); }
  let bodyPath = null;
  try {
    if (navItem) {
      const doc = parseXhtml(await readText(zip, navItem.path));
      for (const a of byLocal(doc, 'a')) {
        const t = a.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || a.getAttribute('epub:type') || '';
        if (/\bbodymatter\b/.test(t) && a.getAttribute('href')) { bodyPath = resolve(navItem.path, decode(stripHash(a.getAttribute('href')))); break; }
      }
    }
    if (!bodyPath) {
      const ref = byLocal(opf, 'reference').find(r => /^(text|start|bodymatter)$/i.test(r.getAttribute('type') || ''));
      if (ref) bodyPath = resolve(opfPath, decode(stripHash(ref.getAttribute('href') || '')));
    }
  } catch (e) { console.warn('landmarks', e); }
  return { map, navPath: navItem ? navItem.path : null, bodyPath };
}

async function isDrm(zip) {
  const f = zipFile(zip, 'META-INF/encryption.xml');
  if (!f) return false;
  const text = await f.async('string');
  // Font obfuscation is fine; encrypted text documents are DRM.
  const uris = [...text.matchAll(/URI="([^"]+)"/g)].map(m => m[1]);
  return uris.some(u => /\.(x?html?|xml)$/i.test(u)) || zipFile(zip, 'META-INF/rights.xml') !== null;
}

export function detectLang(sample, declared) {
  let cjk = 0, latin = 0;
  for (const ch of sample.slice(0, 4000)) {
    if (CJK.test(ch)) cjk++;
    else if (/[A-Za-z]/.test(ch)) latin++;
  }
  if (cjk + latin === 0) return /^ja/i.test(declared || '') ? 'ja' : 'en';
  return cjk / (cjk + latin) > 0.3 ? 'ja' : 'en';
}

export async function parseEpub(buf) {
  if (typeof JSZip === 'undefined') throw new EpubError('Zip reader failed to load');
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch { throw new EpubError('This file is not a valid epub'); }
  if (await isDrm(zip)) throw new EpubError('This book is copy-protected (DRM), so it can\'t be opened');
  const container = parseXml(await readText(zip, 'META-INF/container.xml'));
  const rootfile = container && byLocal(container, 'rootfile')[0];
  if (!rootfile) throw new EpubError('This epub has no table of contents file');
  const opfPath = decode(rootfile.getAttribute('full-path'));
  const opf = parseXml(await readText(zip, opfPath));
  if (!opf) throw new EpubError('This epub\'s package file is broken');

  const title = firstText(opf, 'title') || 'Untitled';
  const author = firstText(opf, 'creator');
  const declared = firstText(opf, 'language');

  const manifest = {};
  for (const it of byLocal(opf, 'item')) {
    manifest[it.getAttribute('id')] = {
      path: resolve(opfPath, decode(it.getAttribute('href') || '')),
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || '',
    };
  }
  const { map: toc, navPath, bodyPath } = await tocMap(zip, opfPath, opf, manifest);

  const chapters = [];
  for (const ref of byLocal(opf, 'itemref')) {
    if (ref.getAttribute('linear') === 'no') continue;
    const item = manifest[ref.getAttribute('idref')];
    if (!item || !/html|xml/.test(item.type) || item.path === navPath) continue;
    let text;
    try { text = await readText(zip, item.path); } catch { continue; }
    const doc = parseXhtml(text);
    const body = doc.body || byLocal(doc, 'body')[0];
    if (!body) continue;
    const raw = blocks(body);
    if (!raw.length) continue;
    const heading = byLocal(body, 'h1').concat(byLocal(body, 'h2'), byLocal(body, 'h3'))[0];
    chapters.push({ title: toc.get(item.path) || (heading ? norm(heading.textContent) : ''), raw, body: item.path === bodyPath });
  }
  if (!chapters.length) throw new EpubError('No readable text found in this epub');

  const sample = chapters.slice(0, 6).map(c => c.raw.join(' ')).join(' ');
  const lang = detectLang(sample, declared);
  const ja = lang === 'ja';
  for (const c of chapters) {
    c.paras = c.raw.map(p => normPara(p, ja)).filter(Boolean);
    delete c.raw;
  }
  let n = 0;
  for (const c of chapters) if (!c.title) c.title = ja ? `第${++n}部` : `Part ${++n}`; else n++;
  return { title: norm(title), author: norm(author), lang, chapters: chapters.filter(c => c.paras.length) };
}

export function parsePlainText(title, text) {
  const t = text.replace(/\r\n?/g, '\n');
  const paras = (/\n[ \t]*\n/.test(t) ? t.split(/\n[ \t]*\n/) : t.split('\n')).map(p => p.split('\n').join(' '));
  const lang = detectLang(text, '');
  const ja = lang === 'ja';
  const clean = paras.map(p => normPara(p, ja)).filter(Boolean);
  if (!clean.length) throw new EpubError('There is no text to read');
  const name = norm(title) || clean[0].slice(0, 40);
  return { title: name, author: '', lang, chapters: [{ title: name, paras: clean }] };
}
