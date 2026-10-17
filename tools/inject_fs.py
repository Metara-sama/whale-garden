#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
给 Whale's Garden 的所有页面挂上统一全屏开关（assets/fullscreen.js）。

· 幂等：已经引用过 fullscreen.js 的页面直接跳过
· 二进制读写，不碰编码（有些页面内嵌 base64/中文混杂）
· 已有自己全屏逻辑的项目（touhou / organic-chem-survivor）自动跳过
用法：python3 tools/inject_fs.py
"""
import os
import sys

ROOT = "/sdcard/Download/Operit/whale-garden"
MARK = b"fullscreen.js"
SKIP_DIRS = {"touhou", "organic-chem-survivor"}


def targets():
    out = [os.path.join(ROOT, "index.html")]
    pdir = os.path.join(ROOT, "projects")
    for name in sorted(os.listdir(pdir)):
        p = os.path.join(pdir, name)
        if os.path.isdir(p):
            idx = os.path.join(p, "index.html")
            if os.path.exists(idx):
                out.append(idx)
        elif name.endswith(".html"):
            out.append(p)
    return [f for f in out if os.path.exists(f)]


def rel_src(f):
    depth = os.path.relpath(f, ROOT).count(os.sep)
    return ("../" * depth) + "assets/fullscreen.js"


def main():
    added = skipped = 0
    for f in targets():
        name = os.path.relpath(f, ROOT)
        first = name.split(os.sep)[1] if name.startswith("projects" + os.sep) else ""
        if first.rsplit(".html", 1)[0] in SKIP_DIRS:
            print("SKIP  %-46s 自带全屏" % name)
            skipped += 1
            continue
        data = open(f, "rb").read()
        if MARK in data:
            print("SKIP  %-46s 已挂载" % name)
            skipped += 1
            continue
        src = rel_src(f)
        tag = ('<script src="%s"></script>' % src).encode("utf-8")
        if b"</body>" in data:
            new = data.replace(b"</body>", b"  " + tag + b"\n</body>", 1)
        elif b"</BODY>" in data:
            new = data.replace(b"</BODY>", b"  " + tag + b"\n</BODY>", 1)
        else:
            new = data + b"\n" + tag + b"\n"
        open(f, "wb").write(new)
        print("ADD   %-46s %s" % (name, src))
        added += 1
    print("\n合计：新增 %d 个，跳过 %d 个" % (added, skipped))
    return 0 if added or skipped else 1


if __name__ == "__main__":
    sys.exit(main())