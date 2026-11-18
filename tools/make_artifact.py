"""Copy the app into build/artifact/ for publishing as a Claude page (Artifact).

Usage: python3 -I tools/make_artifact.py
The Artifact host wraps the page in its own <html>/<head>/<body> and already pads
for the phone's safe areas, so this strips the document wrapper and the app's own
safe-area padding. Everything else is the same files as the GitHub Pages version.
Prints the files map for the Artifact publish call.
"""
import json
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'build', 'artifact')
COPY = ['css', 'js', 'vendor', 'samples', 'dict', 'icons']


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
    body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
    keep = [l for l in head.splitlines()
            if re.search(r'<title>|claude:viewport|stylesheet|theme-color', l)]
    fix = ('<style>#reader{padding-block:0 10px}'
           '#library{padding-block:12px 24px}</style>')
    page = '\n'.join(keep) + '\n' + fix + '\n' + body.strip() + '\n'
    with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8') as fh:
        fh.write(page)
    files = {}
    for d in COPY:
        for dirpath, _, names in os.walk(os.path.join(ROOT, d)):
            for n in sorted(names):
                if n.startswith('.'):
                    continue
                src = os.path.join(dirpath, n)
                rel = os.path.relpath(src, ROOT)
                if n.endswith('.epub'):
                    # Artifacts don't serve .epub; ship base64 text the app falls back to
                    import base64
                    rel = rel[:-5] + '.b64.txt'
                    dst = os.path.join(OUT, rel)
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    with open(src, 'rb') as fi, open(dst, 'w') as fo:
                        fo.write(base64.b64encode(fi.read()).decode())
                    files[rel] = os.path.join('build', 'artifact', rel)
                    continue
                dst = os.path.join(OUT, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
                files[rel] = os.path.join('build', 'artifact', rel)
    total = sum(os.path.getsize(os.path.join(OUT, r)) for r in files)
    print(json.dumps(files))
    print(f'{len(files)} files, {total / 1e6:.1f} MB', file=__import__('sys').stderr)


if __name__ == '__main__':
    main()
