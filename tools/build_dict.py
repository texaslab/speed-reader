"""Build the compact Japanese-English dictionary shards from jmdict-simplified.

Usage: python3 -I tools/build_dict.py <path to jmdict-eng-X.json> <out dir, e.g. dict>

Each word is filed under every written form (kanji and kana). Shard = first
character code % SHARDS, so a lookup loads only the shards for the first
characters it tries. Shard file: {"e": [entry, ...], "i": {form: [entry index, ...]}}
Entry: [kanji forms, kana forms, word classes, senses, common]
  word classes: subset of v1 v5 vk vs adj-i (what the deinflector checks)
  sense: [part-of-speech label, glosses joined with "; "]
"""
import json
import os
import sys

SHARDS = 64
MAX_SENSES = 4
MAX_GLOSSES = 3

POS_LABEL = {
    "n": "noun", "adj-i": "i-adj", "adj-ix": "i-adj", "adj-na": "na-adj", "adj-no": "no-adj",
    "adj-pn": "pre-noun", "adj-t": "taru-adj", "adj-f": "adj", "adv": "adverb", "adv-to": "adverb",
    "aux": "auxiliary", "aux-v": "aux verb", "aux-adj": "aux adj", "conj": "conjunction",
    "cop": "copula", "ctr": "counter", "exp": "expression", "int": "interjection",
    "n-adv": "noun, adverb", "n-pr": "name", "n-suf": "noun suffix", "n-pref": "noun prefix",
    "n-t": "noun (time)", "num": "number", "pn": "pronoun", "pref": "prefix", "prt": "particle",
    "suf": "suffix", "v1": "ichidan verb", "v1-s": "ichidan verb", "vk": "kuru verb",
    "vs": "suru verb", "vs-i": "suru verb", "vs-s": "suru verb", "vz": "zuru verb",
    "vi": "intransitive", "vt": "transitive", "unc": "",
}


def word_classes(pos_list):
    out = set()
    for p in pos_list:
        if p in ("v1", "v1-s"):
            out.add("v1")
        elif p.startswith("v5"):
            out.add("v5")
        elif p == "vk":
            out.add("vk")
        elif p in ("vs", "vs-i", "vs-s"):
            out.add("vs")
        elif p in ("adj-i", "adj-ix"):
            out.add("adj-i")
    return sorted(out)


def label(pos_list):
    names = []
    for p in pos_list:
        if p.startswith("v5"):
            n = "godan verb"
        else:
            n = POS_LABEL.get(p)
        if n and n not in names:
            names.append(n)
    return ", ".join(names)


def main(src, out):
    data = json.load(open(src, encoding="utf-8"))
    shards = [{"e": [], "i": {}} for _ in range(SHARDS)]
    for w in data["words"]:
        kanji = [k["text"] for k in w["kanji"] if "sK" not in k.get("tags", [])]
        kana = [k["text"] for k in w["kana"] if "sk" not in k.get("tags", [])]
        if not kana:
            continue
        common = int(any(k["common"] for k in w["kanji"]) or any(k["common"] for k in w["kana"]))
        all_pos = []
        senses = []
        for s in w["sense"]:
            all_pos += s["partOfSpeech"]
            if len(senses) >= MAX_SENSES:
                continue
            glosses = [g["text"] for g in s["gloss"] if g.get("lang", "eng") == "eng"][:MAX_GLOSSES]
            if glosses:
                senses.append([label(s["partOfSpeech"]), "; ".join(glosses)])
        if not senses:
            continue
        entry = [kanji, kana, word_classes(all_pos), senses, common]
        forms = list(dict.fromkeys(kanji + kana))
        placed = {}
        for f in forms:
            sh = ord(f[0]) % SHARDS
            if sh not in placed:
                shards[sh]["e"].append(entry)
                placed[sh] = len(shards[sh]["e"]) - 1
            shards[sh]["i"].setdefault(f, []).append(placed[sh])
    os.makedirs(out, exist_ok=True)
    total = 0
    for n, sh in enumerate(shards):
        # common words first for each form
        for f, idxs in sh["i"].items():
            idxs.sort(key=lambda i: -sh["e"][i][4])
        path = os.path.join(out, f"{n:02d}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(sh, fh, ensure_ascii=False, separators=(",", ":"))
        total += os.path.getsize(path)
    meta = {"shards": SHARDS, "version": data.get("version"), "date": data.get("dictDate"),
            "words": len(data["words"])}
    with open(os.path.join(out, "meta.json"), "w") as fh:
        json.dump(meta, fh)
    print(f"wrote {SHARDS} shards, {total/1e6:.1f} MB total")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
