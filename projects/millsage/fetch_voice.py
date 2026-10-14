# -*- coding: utf-8 -*-
"""下载 millsage 剧情语音到本地（供 story_voice.html 离线使用）
用法: python3 fetch_voice.py [main] [event] [friendship] [live-result] [home]
     不带参数 = 只下主线
输出: ./音频/<URL相对路径>   例如 音频/adv_voice_millsage_004_1_01/xxx.m4a
下载完成后，把 story_voice.html 里的 PREFIX 改成 "音频/" 即可离线播放。
"""
import json, glob, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = '/sdcard/Download/Operit/millsage/raw'
OUT = os.path.join(HERE, '音频')
PREFIX = 'https://assets.bdon.moe/zh-Hans/Cri/Sound/'
UA = {'User-Agent': 'Mozilla/5.0 (Linux; Android 14)'}
cats = sys.argv[1:] or ['main']


def collect():
    urls = set()
    for p in glob.glob(RAW + '/*.json'):
        d = json.load(open(p, encoding='utf-8'))
        if d['meta']['category'] not in cats:
            continue
        for e in d['entries']:
            v = (e.get('voice') or '').replace(PREFIX, '')
            if v:
                urls.add(v)
    return sorted(urls)


def get(rel):
    dst = os.path.join(OUT, rel)
    if os.path.exists(dst) and os.path.getsize(dst) > 500:
        return 0
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        r = urllib.request.Request(PREFIX + rel, headers=UA)
        data = urllib.request.urlopen(r, timeout=40).read()
        open(dst, 'wb').write(data)
        return 1
    except Exception:
        return -1


def main():
    urls = collect()
    print('分类', cats, '语音', len(urls), '条 ->', OUT)
    done = new = fail = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for i, r in enumerate(ex.map(get, urls), 1):
            if r == 1:
                new += 1
            elif r == -1:
                fail += 1
            else:
                done += 1
            if i % 100 == 0:
                print('  %d/%d  new=%d cached=%d fail=%d' % (i, len(urls), new, done, fail))
    print('完成: 新下载 %d，已存在 %d，失败 %d' % (new, done, fail))
    print('现在把 story_voice.html 里的 PREFIX 改成 "音频/" 即可离线播放。')


if __name__ == '__main__':
    main()