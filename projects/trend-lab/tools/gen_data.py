#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 trend-lab 的内置数据集 js/data.js

数据形态说明（页面底部也会明写）：
  · 这是「按公开热搜形态构造的示例历史集」，不是爬下来的真实历史。
  · 每天每平台每个词一个「搜索词频指数」（0–100000 量级）。
  · 事件脉冲按平台错峰：微博先爆 → B 站滞后 1–2 天 → 百度滞后 1 天，
    这样三平台曲线才有真实的时间差，不是三条同形曲线换个高度。

用法：python3 tools/gen_data.py
"""
import json
import math
import random
import datetime
import os

random.seed(20261019)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "js", "data.js")

N_DAYS = 140
END = datetime.date(2026, 10, 19)
START = END - datetime.timedelta(days=N_DAYS - 1)

PLATFORMS = [
    {"id": "baidu", "name": "百度", "color": "#3f6ad8", "lag": 1, "wk": (1.05, 0.94, 0.93)},
    {"id": "bilibili", "name": "B站", "color": "#e2637f", "lag": 2, "wk": (0.99, 1.10, 1.12)},
    {"id": "weibo", "name": "微博", "color": "#e0903c", "lag": 0, "wk": (1.00, 1.08, 1.10)},
]

# 词：百度 / B站 / 微博 的基础热度（示例量级，非真实统计）
WORDS = [
    ("AI绘画", 22000, 18000, 12000),
    ("考研", 48000, 15000, 21000),
    ("双十一", 62000, 9000, 55000),
    ("台风", 71000, 6000, 33000),
    ("演唱会", 18000, 21000, 68000),
    ("新番", 6000, 42000, 12000),
    ("房贷利率", 38000, 4000, 16000),
    ("猫meme", 9000, 36000, 24000),
    ("装机", 21000, 26000, 5000),
    ("A股", 55000, 7000, 42000),
    ("减肥", 33000, 9000, 47000),
    ("电影", 26000, 14000, 39000),
    ("综艺", 20000, 11000, 52000),
    ("原神", 24000, 58000, 30000),
    ("高考", 58000, 12000, 35000),
    ("颈椎病", 27000, 5000, 11000),
    ("旅游", 31000, 7000, 28000),
    ("加班", 15000, 6000, 25000),
]
WORD_NAMES = [w[0] for w in WORDS]

days = [START + datetime.timedelta(days=i) for i in range(N_DAYS)]

# ---- 事件脉冲：随机挑词，给一段高斯凸起 ----
EVENT_WORDS = random.sample(WORD_NAMES, 8)
events = []  # (word, center_idx, width, amp)
for w in EVENT_WORDS:
    cnt = random.choice([1, 1, 2])
    for _ in range(cnt):
        center = random.randint(4, N_DAYS - 3)
        events.append((w, center, random.uniform(3.4, 8.0), random.uniform(0.55, 1.9)))

# 每个词一条平缓的季节性相位
phase = {w: random.uniform(0, 6.283) for w in WORD_NAMES}


def value(wi, pi, i):
    word = WORDS[wi]
    base = word[1 + pi]
    pmeta = PLATFORMS[pi]
    # 周内周期
    wd = days[i].weekday()  # 0=周一
    if wd <= 4:
        week = pmeta["wk"][0]
    elif wd == 5:
        week = pmeta["wk"][1]
    else:
        week = pmeta["wk"][2]
    # 长假/大促之类的缓慢抬升
    slow = 1 + 0.13 * math.sin(i / 9.0 + phase[word[0]])
    if word[0] in ("双十一", "旅游", "电影"):
        slow += 0.30 * max(0.0, math.sin((i - 96) / 13.0))
    # 事件
    ev = 1.0
    for (w, center, width, amp) in events:
        if w != word[0]:
            continue
        delay = pmeta["lag"]
        d = i - (center + delay)
        ev += amp * math.exp(-(d * d) / (2 * width * width))
    noise = random.uniform(0.88, 1.13)
    v = base * week * slow * ev * noise
    # 低频抖动，让曲线别太整齐
    v *= 1 + 0.04 * math.sin(i * 1.7 + wi)
    return int(max(120, v))


series = {}
for pi, p in enumerate(PLATFORMS):
    rows = []
    for wi in range(len(WORDS)):
        rows.append([value(wi, pi, i) for i in range(N_DAYS)])
    series[p["id"]] = rows

payload = {
    "generated": END.isoformat(),
    "start": START.isoformat(),
    "days": [d.isoformat() for d in days],
    "platforms": [{k: v for k, v in p.items() if k not in ("lag", "wk")} for p in PLATFORMS],
    "words": WORD_NAMES,
    "series": series,
    "note": "示例数据集：按公开热搜形态构造，非真实爬取历史。",
}

js = "/* 自动生成：python3 tools/gen_data.py —— 别手改 */\n"
js += "window.TREND_DATA=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"

with open(OUT, "w", encoding="utf-8") as f:
    f.write(js)

size = os.path.getsize(OUT)
print("写下 %s  %d 天 × %d 词 × %d 平台  %.1f KB" % (
    OUT, N_DAYS, len(WORDS), len(PLATFORMS), size / 1024.0))
print("事件脉冲词：", "、".join(EVENT_WORDS))
