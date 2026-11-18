"""Turn an Aozora Bunko XHTML page into a small EPUB 3 (keeps <ruby> furigana).

Usage: python3 -I tools/make_sample_ja.py <aozora .html (Shift_JIS)> <out .epub>
Used for samples/kumo-no-ito.epub (芥川龍之介「蜘蛛の糸」, public domain).
"""
import re
import sys
import zipfile

GAIJI = {"1-87-71": "犍"}


def clean(html):
    html = re.sub(r'<img[^>]*gaiji/[^>]*/(\d-\d\d-\d\d)\.png[^>]*/>',
                  lambda m: GAIJI.get(m.group(1), "〓"), html)
    html = re.sub(r"<br\s*/>", "", html)
    html = re.sub(r'<div[^>]*>|</div>', "", html)
    return html


def main(src, out):
    raw = open(src, "rb").read().decode("shift_jis", errors="replace")
    title = re.search(r'<h1 class="title">(.*?)</h1>', raw).group(1)
    author = re.search(r'<h2 class="author">(.*?)</h2>', raw).group(1)
    main_text = re.search(r'<div class="main_text">(.*?)<div class="bibliographical_information">', raw, re.S).group(1)
    biblio = re.search(r'<div class="bibliographical_information">(.*?)</div>', raw, re.S).group(1)
    parts = re.split(r'<h4 class="naka-midashi"><a[^>]*>(.*?)</a></h4>', main_text)
    sections = []
    for i in range(1, len(parts), 2):
        head = parts[i]
        body = clean(parts[i + 1])
        paras = [p.strip() for p in body.split("\n") if p.strip()]
        sections.append((head, paras))
    biblio_lines = [re.sub(r"<[^>]+>", "", l).strip() for l in re.split(r"<br\s*/>", biblio)]
    biblio_lines = [l for l in biblio_lines if l]

    def page(head, paras, cls=""):
        ps = "\n".join(f"<p>{p}</p>" for p in paras)
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head><title>{head}</title><link rel="stylesheet" href="style.css"/></head>
<body class="{cls}"><section><h2>{head}</h2>
{ps}
</section></body></html>"""

    files = {}
    files["OEBPS/style.css"] = "html{writing-mode:vertical-rl;-epub-writing-mode:vertical-rl}"
    files["OEBPS/title.xhtml"] = page(title, [author])
    for n, (head, paras) in enumerate(sections, 1):
        files[f"OEBPS/s{n}.xhtml"] = page(head, paras)
    files["OEBPS/colophon.xhtml"] = page("底本", biblio_lines)
    spine = ["title"] + [f"s{n}" for n in range(1, len(sections) + 1)] + ["colophon"]
    items = "\n".join(f'<item id="{s}" href="{s}.xhtml" media-type="application/xhtml+xml"/>' for s in spine)
    refs = "\n".join(f'<itemref idref="{s}"/>' for s in spine)
    nav_li = "\n".join(f'<li><a href="s{n}.xhtml">{h}</a></li>' for n, (h, _) in enumerate(sections, 1))
    files["OEBPS/nav.xhtml"] = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ja">
<head><title>目次</title></head><body><nav epub:type="toc"><h1>目次</h1><ol>
<li><a href="title.xhtml">{title}</a></li>
{nav_li}
</ol></nav></body></html>"""
    files["OEBPS/content.opf"] = f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="ja">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:aozora:92</dc:identifier>
<dc:title>{title}</dc:title><dc:creator>{author}</dc:creator><dc:language>ja</dc:language>
<meta property="dcterms:modified">2026-11-18T00:00:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
{items}
</manifest>
<spine page-progression-direction="rtl">
{refs}
</spine></package>"""
    files["META-INF/container.xml"] = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"""
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        for name, text in files.items():
            z.writestr(name, text, compress_type=zipfile.ZIP_DEFLATED)
    print(f"{out}: {title} / {author}, {len(sections)} sections")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
