#!/usr/bin/env python3
"""Whale's Garden 字体工具

一次性生成 assets/fonts/*.woff2 与 fonts.css：
  - 中文：站酷快乐体（ZCOOL KuaiLe，免费商用）按 unicode-range 切片，
          收录 GB2312 符号区 + 一级汉字 + 网页实际用字，
          浏览器只会下载用到的片，首页通常只吃几十 KB。
  - 英文：Fredoka 700（圆胖气泡感），固定为拉丁子集。
  - 两个字体都自托管，不依赖任何 CDN。

以后网页加了新字（页面出现方框），重跑一次即可：
    python3 tools/mkfont.py
"""

import glob
import os
import re
import urllib.request

BASE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(BASE, "assets", "fonts")
CACHE = "/tmp/fonts"

SOURCES = {
    "zcool.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf",
    "fredoka.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/fredoka/Fredoka%5Bwdth%2Cwght%5D.ttf",
}

PER_CHUNK = 120
TEXT_FILES = ["index.html", "app.js", "projects.js", "style.css", "fonts.css", "README.md"]


def ensure(name):
    """确保源字体存在，缺失则下载到 /tmp/fonts 缓存。"""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if os.path.exists(path) and os.path.getsize(path) > 50000:
        return path
    print("downloading", name)
    req = urllib.request.Request(SOURCES[name], headers={"User-Agent": "Mozilla/5.0"})
    data = urllib.request.urlopen(req, timeout=180).read()
    with open(path, "wb") as f:
        f.write(data)
    return path


def urange(codes):
    """把码位列表转成 unicode-range 字符串，合并连续区间。"""
    codes = sorted(set(codes))
    segs = []
    start = prev = codes[0]
    for c in codes[1:]:
        if c == prev + 1:
            prev = c
        else:
            segs.append((start, prev))
            start = prev = c
    segs.append((start, prev))
    parts = []
    for a, b in segs:
        parts.append("U+%04X" % a if a == b else "U+%04X-%04X" % (a, b))
    return ",".join(parts)


def collect_chars():
    """GB2312 符号区 + 一级汉字 + 网页实际出现的非 ASCII 字符。"""
    chars = set()
    for hi in range(0xA1, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                chars.add(bytes([hi, lo]).decode("gb2312"))
            except Exception:
                pass
    for fn in TEXT_FILES:
        p = os.path.join(BASE, fn)
        if os.path.exists(p):
            with open(p, encoding="utf-8", errors="ignore") as f:
                chars |= set(re.findall(r"[^\x00-\x7f]", f.read()))
    return chars


def main():
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer

    zcool = ensure("zcool.ttf")
    fredoka = ensure("fredoka.ttf")

    os.makedirs(OUT, exist_ok=True)
    for old in glob.glob(os.path.join(OUT, "*.woff2")):
        os.remove(old)

    font_cmap = set(TTFont(zcool).getBestCmap().keys())
    chars = sorted(c for c in collect_chars() if ord(c) in font_cmap)
    print("glyphs to embed:", len(chars))

    css = []
    chunks = [chars[i:i + PER_CHUNK] for i in range(0, len(chars), PER_CHUNK)]
    for idx, chunk in enumerate(chunks):
        name = "zcool-%03d.woff2" % idx
        font = TTFont(zcool)
        opts = subset.Options()
        opts.layout_features = ["*"]
        opts.drop_tables += ["DSIG"]
        ss = subset.Subsetter(options=opts)
        ss.populate(unicodes=[ord(c) for c in chunk])
        ss.subset(font)
        font.flavor = "woff2"
        font.save(os.path.join(OUT, name))
        font.close()
        css.append(
            "@font-face{font-family:'WhaleBubble';font-style:normal;font-weight:400;"
            "font-display:swap;src:url('assets/fonts/%s') format('woff2');unicode-range:%s;}"
            % (name, urange([ord(c) for c in chunk]))
        )
    print("cn chunks:", len(chunks))

    font = TTFont(fredoka)
    try:
        instancer.instantiateVariableFont(font, {"wght": 700, "wdth": 100}, inplace=True)
    except Exception as exc:  # 轴名变化时退化为保留可变轴
        print("instancer skipped:", exc)
    opts = subset.Options()
    opts.layout_features = ["kern", "liga"]
    ss = subset.Subsetter(options=opts)
    ss.populate(unicodes=list(range(0x20, 0x7F)) + [0xA0, 0xB7, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026])
    ss.subset(font)
    font.flavor = "woff2"
    font.save(os.path.join(OUT, "fredoka-700.woff2"))
    font.close()
    css.append(
        "@font-face{font-family:'WhaleBubbleEN';font-style:normal;font-weight:700;"
        "font-display:swap;src:url('assets/fonts/fredoka-700.woff2') format('woff2');"
        "unicode-range:U+0000-00FF,U+2013-2014,U+2018-201D,U+2026;}"
    )

    with open(os.path.join(BASE, "fonts.css"), "w", encoding="utf-8") as f:
        f.write("/* Whale's Garden 字体声明 —— 由 tools/mkfont.py 自动生成，请勿手改 */\n")
        f.write("\n".join(css))
        f.write("\n")

    files = os.listdir(OUT)
    total = sum(os.path.getsize(os.path.join(OUT, x)) for x in files)
    print("done. %d files, %.1f KB total, fonts.css %.1f KB"
          % (len(files), total / 1024.0, os.path.getsize(os.path.join(BASE, "fonts.css")) / 1024.0))


main()
