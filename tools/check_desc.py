#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
校验 projects.js 里每条项目简介是不是「一句话且 ≤30 字」。
标准见 skill: whale-standard 第 3 节。
用法：python3 tools/check_desc.py
退出码 0 = 全过；1 = 有超标。
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
P = os.path.join(ROOT, "projects.js")

LIMIT = 30
# 已定稿、豁免的条目
ALLOW = {"邦友的酒模拟器"}

src = open(P, encoding="utf-8").read()
blocks = re.findall(
    r'name:\s*"([^"]+)",\s*\n\s*desc:\s*"((?:[^"\\]|\\.)*)"', src
)
if not blocks:
    print("✗ 没解析到任何项目，检查 projects.js 格式")
    sys.exit(1)

bad = 0
print("%-24s %5s  %s" % ("项目", "字数", "简介"))
print("-" * 78)
for name, desc in blocks:
    plain = re.sub(r"\s+", "", desc)
    n = len(plain)
    over = n > LIMIT
    exempt = " (豁免)" if name in ALLOW else ""
    if over and name not in ALLOW:
        bad += 1
    print("%-24s %5d  %s%s%s" % (name, n, desc, exempt, "  ← 超长!" if over else ""))
print("-" * 78)
# 顺带查：以句号/感叹号/问号结尾？
for name, desc in blocks:
    if not re.search(r"[。！？]$", desc.strip()):
        print("! 结尾不是句号/感叹号：%s" % name)
        bad += 1

if bad:
    print("\n✗ %d 条不合规（≤%d 字、一句话收尾）" % (bad, LIMIT))
    sys.exit(1)
print("\n✓ 全部合规：%d 条，最长 %d 字" % (
    len(blocks), max(len(re.sub(r"\s+", "", d)) for _, d in blocks)))
sys.exit(0)