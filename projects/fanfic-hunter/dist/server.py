#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FANFIC HUNTER // 同人文猎手 · 本地代理服务
零第三方依赖：只用 Python 标准库

  贴吧 + NGA 双站搜索 / 全帖抓取 / 仅看楼主 / 导出 TXT

启动：  python3 server.py [端口]
默认：  http://127.0.0.1:18660
"""

import os
import re
import json
import ssl
import sys
import time
import gzip
import zlib
import urllib.request
import urllib.error
from html import unescape
from urllib.parse import urlparse, parse_qs, quote
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
CONF_PATH = os.path.join(BASE, "conf.json")
OUT_DIR = os.path.join(BASE, "out")
DBG_DIR = os.path.join(BASE, "debug")
for d in (OUT_DIR, DBG_DIR):
    os.makedirs(d, exist_ok=True)

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 18660

UA_PC = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
         "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
UA_MB = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
         "(KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36")

_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE


# ----------------------------------------------------------------------------- 配置
DEFAULT_CONF = {
    "tieba_cookie": "",
    "nga_cookie": "",
    "timeout": 20,
}


def load_conf():
    c = dict(DEFAULT_CONF)
    try:
        with open(CONF_PATH, "r", encoding="utf-8") as f:
            c.update(json.load(f) or {})
    except Exception:
        pass
    return c


def save_conf(c):
    merged = dict(DEFAULT_CONF)
    merged.update(c or {})
    with open(CONF_PATH, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
    return merged


# ----------------------------------------------------------------------------- HTTP
def decode_body(raw, headers):
    ctype = headers.get("Content-Type", "") or ""
    m = re.search(r"charset\s*=\s*([\w\-]+)", ctype, re.I)
    encs = []
    if m:
        encs.append(m.group(1))
    encs += ["utf-8", "gb18030"]
    for e in encs:
        try:
            return raw.decode(e)
        except Exception:
            continue
    return raw.decode("utf-8", "ignore")


def fetch(url, cookie="", referer="", ua=UA_PC, timeout=20, extra=None):
    """返回 dict(status, text, final_url, headers)"""
    hdr = {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "close",
    }
    if cookie:
        hdr["Cookie"] = cookie
    if referer:
        hdr["Referer"] = referer
    if extra:
        hdr.update(extra)
    req = urllib.request.Request(url, headers=hdr)
    try:
        r = urllib.request.urlopen(req, timeout=timeout, context=_CTX)
        raw = r.read()
        status = r.status
        h = r.headers
    except urllib.error.HTTPError as e:
        try:
            raw = e.read()
        except Exception:
            raw = b""
        status = e.code
        h = e.headers or {}
    except Exception as e:
        return {"status": -1, "text": "", "err": "%s: %s" % (type(e).__name__, e),
                "final_url": url, "headers": {}}

    enc = (h.get("Content-Encoding", "") or "").lower()
    try:
        if "gzip" in enc:
            raw = gzip.decompress(raw)
        elif "deflate" in enc:
            try:
                raw = zlib.decompress(raw)
            except Exception:
                raw = zlib.decompress(raw, -zlib.MAX_WBITS)
    except Exception:
        pass

    return {"status": status, "text": decode_body(raw, h),
            "final_url": url, "headers": dict(h)}


# ----------------------------------------------------------------------------- 清洗工具
TAG_RE = re.compile(r"<[^>]+>")


def html2text(s, keep_img=True):
    if not s:
        return ""
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</p\s*>", "\n", s)
    s = re.sub(r"(?i)<(script|style)[^>]*>.*?</\1>", "", s, flags=re.S)
    if keep_img:
        def _img(m):
            src = m.group(1) or ""
            tail = src.rsplit("/", 1)[-1][:40]
            return "\n[图片:%s]\n" % tail
        s = re.sub(r"(?i)<img[^>]+(?:src|data-original)\s*=\s*[\"']([^\"']+)[\"'][^>]*>", _img, s)
    s = TAG_RE.sub("", s)
    s = unescape(s)
    s = s.replace("\u200b", "").replace("\xa0", " ")
    s = re.sub(r"[ \t]{2,}", " ", s)
    s = re.sub(r"\n[ \t]+", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def slice_balanced(html, idx):
    """从 idx（指向 <tag）开始，返回(整段HTML, 结束位置)，按同名标签配平"""
    m = re.match(r"<([a-zA-Z][\w\-]*)", html[idx:])
    if not m:
        return "", idx
    tag = m.group(1)
    pat = re.compile(r"<(/?)%s\b[^>]*?(/?)>" % re.escape(tag), re.I)
    depth = 0
    pos = idx
    while True:
        mm = pat.search(html, pos)
        if not mm:
            return html[idx:], len(html)
        if mm.group(1):
            depth -= 1
            if depth <= 0:
                return html[idx:mm.end()], mm.end()
        else:
            if mm.group(2):
                if depth == 0:
                    return html[idx:mm.end()], mm.end()
            else:
                depth += 1
        pos = mm.end()


def save_debug(site, kind, text):
    try:
        fn = os.path.join(DBG_DIR, "%s_%s_%s.html" % (site, kind, time.strftime("%m%d_%H%M%S")))
        with open(fn, "w", encoding="utf-8") as f:
            f.write(text or "")
        return fn
    except Exception:
        return ""


def looks_like_login_wall(site, text):
    if site == "nga":
        if "msgcode" in text and "2048" in text[:4000]:
            return "NGA 未登录（ERROR 2048）：请在设置里填入 ngaPassportUid / ngaPassportCid"
        if "nuke.php?__lib=login" in text and "read.php" not in text:
            return "NGA 需要登录 Cookie"
    if site == "tieba":
        low = text[:6000]
        if "百度安全验证" in low or "wappass" in low:
            return "贴吧触发安全验证，Cookie 失效或被风控（可稍后重试 / 换 Cookie）"
        if "登录" in low and len(text) < 12000 and "l_post" not in text and "s_post" not in text:
            return "贴吧需要登录 Cookie（BDUSS）"
    return ""


# ----------------------------------------------------------------------------- Cookie 智能提取
TIEBA_KEYS = ["BDUSS_BFESS", "BDUSS", "STOKEN", "PTOKEN", "BAIDUID_BFESS",
              "BAIDUID", "ZFY", "TIEBA_USERTYPE", "TIEBA_SID"]
NGA_KEYS = ["ngaPassportUid", "ngaPassportCid", "ngaPassportUrlencodedUname",
            "guestJs", "lastvisit", "lastpath"]


def sanitize_cookie(site, raw):
    """用户随便贴什么都行：从一坨文本里抽出真正需要的字段，重组成规范串"""
    raw = (raw or "").strip()
    if not raw:
        return ""
    keys = TIEBA_KEYS if site == "tieba" else NGA_KEYS
    got = {}
    for k in keys:
        m = re.search(r"(?:^|[;,\s\"'])" + re.escape(k) + r"\s*=\s*([^;\s\"',}]+)", raw)
        if m:
            got[k] = m.group(1).strip()
    if site == "nga" and ("ngaPassportUid" not in got or "ngaPassportCid" not in got):
        return ""   # 关键字段缺失，判无效
    if site == "tieba" and "BDUSS" not in got and "BDUSS_BFESS" not in got:
        return ""
    # 保持稳定顺序（BDUSS 在前的顺序对贴吧更友好）
    return "; ".join("%s=%s" % (k, got[k]) for k in keys if k in got)


def fetch_raw(url, referer="", ua=UA_PC, timeout=15):
    """下载二进制（图片等）"""
    hdr = {"User-Agent": ua, "Accept": "*/*", "Accept-Encoding": "gzip, deflate"}
    if referer:
        hdr["Referer"] = referer
    r = urllib.request.urlopen(urllib.request.Request(url, headers=hdr),
                               timeout=timeout, context=_CTX)
    raw = r.read()
    if (r.headers.get("Content-Encoding") or "").lower() == "gzip":
        try:
            raw = gzip.decompress(raw)
        except Exception:
            pass
    return raw, r.headers.get("Content-Type", "")


# ----------------------------------------------------------------------------- 扫码登录（贴吧 / 百度）
def baidu_qr_new():
    tt = str(int(time.time() * 1000))
    url = ("https://passport.baidu.com/v2/api/getqrcode?lp=pc&qrloginfrom=pc"
           "&apiver=v3&tt=%s&tpl=mn&_=%s" % (tt, tt))
    r = fetch(url, referer="https://passport.baidu.com/", ua=UA_PC, timeout=15)
    if r["status"] != 200:
        return {"ok": False, "error": "二维码接口不可达"}
    try:
        d = json.loads(r["text"])
    except Exception:
        return {"ok": False, "error": "二维码接口返回异常"}
    if d.get("errno") != 0 or not d.get("sign"):
        return {"ok": False, "error": "二维码获取失败"}
    sign = d["sign"]
    img = ""
    try:
        raw, ctype = fetch_raw("https://" + d["imgurl"],
                               referer="https://passport.baidu.com/", timeout=15)
        if raw and raw[:4] == b"\x89PNG":
            import base64
            img = "data:image/png;base64," + base64.b64encode(raw).decode()
    except Exception:
        pass
    return {"ok": True, "sign": sign, "img": img,
            "imgurl": "https://" + d.get("imgurl", "")}


def baidu_qr_poll(sign):
    tt = str(int(time.time() * 1000))
    u = ("https://passport.baidu.com/channel/unicast?channel_id=%s&tpl=mn"
         "&apiver=v3&tt=%s&_=%s" % (quote(sign), tt, tt))
    r = fetch(u, referer="https://passport.baidu.com/", ua=UA_PC, timeout=7)
    if r["status"] != 200:
        return {"ok": True, "state": "wait"}     # 长轮询没返回 = 还没扫
    txt = (r["text"] or "").strip()
    m = re.search(r"\{.*\}", txt, re.S)
    if not m:
        return {"ok": True, "state": "wait"}
    try:
        d = json.loads(m.group(0))
    except Exception:
        return {"ok": True, "state": "wait"}
    cv = d.get("channel_v")
    if isinstance(cv, str):
        try:
            cv = json.loads(cv)
        except Exception:
            cv = {}
    if not isinstance(cv, dict):
        cv = {}
    v = cv.get("v") or ""
    status = cv.get("status")
    if v and len(v) > 40 and not v.isdigit():
        return {"ok": True, "state": "done", "bduss": v}
    if str(status) == "2" or d.get("errno") in (1, 2):
        if not v:
            return {"ok": True, "state": "expired"}
    return {"ok": True, "state": "wait"}


def verify_bduss(bduss):
    r = fetch("https://tieba.baidu.com/f/user/json_userinfo",
              cookie="BDUSS=" + bduss, referer="https://tieba.baidu.com/",
              ua=UA_PC, timeout=12)
    try:
        d = json.loads((r["text"] or "").strip())
    except Exception:
        return ""
    data = d.get("data") or {}
    if isinstance(data, dict):
        return data.get("user_name") or data.get("user_name_show") or ""
    return ""


def merge_bduss(old, bduss):
    parts = [p.strip() for p in (old or "").split(";") if p.strip()]
    parts = [p for p in parts
             if not p.startswith("BDUSS=") and not p.startswith("BDUSS_BFESS=")]
    parts.insert(0, "BDUSS=" + bduss)
    merged = "; ".join(parts)
    return sanitize_cookie("tieba", merged) or merged


# ----------------------------------------------------------------------------- 贴吧
def ts2date(v):
    try:
        n = int(v)
        if n <= 0:
            return ""
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(n))
    except Exception:
        return str(v or "")


SORTS = ("rel", "time_desc", "time_asc", "reply_desc")


def sort_items(items, sort):
    if sort == "time_desc":
        items.sort(key=lambda it: (it.get("date") or "", it.get("reply") or "0"),
                   reverse=True)
    elif sort == "time_asc":
        items.sort(key=lambda it: (it.get("date") or "9999", ))
    elif sort == "reply_desc":
        def n(it):
            try:
                return int(it.get("reply") or 0)
            except Exception:
                return 0
        items.sort(key=n, reverse=True)
    return items


def dedupe(items):
    seen, out = set(), []
    for it in items:
        k = "%s|%s" % (it.get("site"), it.get("tid"))
        if k in seen:
            continue
        seen.add(k)
        out.append(it)
    return out


def tieba_mobile_search(q, page=1, kw="", sort="rel"):
    """贴吧移动搜索 JSON 接口：**无需任何 Cookie**
    注意：该接口实测只吃 pn=0 / pn=20 两页，pn>=40 会回退成第一页，
    所以第 3 页起直接返回空并标记到底，避免重复追加。"""
    if page >= 3:
        return {"ok": True, "site": "tieba", "items": [], "page": page,
                "has_more": False, "nocookie": True,
                "note": "贴吧搜索接口最多 2 页（约 30 条），已到底"}
    pn = max(0, (page - 1) * 20)
    url = "https://tieba.baidu.com/mo/q/search/thread?word=%s&pn=%d" % (quote(q), pn)
    conf = load_conf()
    r = fetch(url, cookie="", referer="https://tieba.baidu.com/",
              ua=UA_MB, timeout=conf["timeout"])
    text = r["text"]
    if r["status"] != 200:
        return {"ok": False, "site": "tieba", "code": r["status"],
                "error": r.get("err") or ("HTTP %s" % r["status"]),
                "debug": save_debug("tieba", "msearch", text), "items": []}
    try:
        data = json.loads(text)
    except Exception:
        return {"ok": False, "site": "tieba", "code": r["status"],
                "error": "接口返回非 JSON（可能被风控）",
                "debug": save_debug("tieba", "msearch", text), "items": []}

    payload = data.get("data") or {}
    posts = payload.get("post_list") or []
    items = []
    for p in posts:
        tid = str(p.get("tid") or "")
        if not tid:
            continue
        user = p.get("user")
        uname = ""
        if isinstance(user, dict):
            uname = user.get("user_name") or ""
        else:
            m = re.search(r"'user_name':\s*'([^']*)'", str(user or ""))
            if m:
                uname = m.group(1)
        forum = p.get("forum_name") or ""
        if not forum:
            m = re.search(r"'forum_name':\s*'([^']*)'", str(p.get("forum_info") or ""))
            if m:
                forum = m.group(1)
        content = re.sub(r"\s+", " ", html2text(p.get("content") or "", keep_img=False))
        title = re.sub(r"\s+", " ", p.get("title") or "").strip()
        items.append({
            "site": "tieba", "tid": tid,
            "title": title or (content[:40] or "（无标题）"),
            "brief": content[:220],
            "date": ts2date(p.get("create_time") or p.get("time")),
            "author": uname, "forum": forum,
            "reply": str(p.get("post_num") or ""),
            "url": "https://tieba.baidu.com/p/%s" % tid,
            "excerpt": content,          # 接口自带摘要，可直接当"帖子开头"用
        })
    if kw:
        k = kw.strip()
        hit = [it for it in items if k and (k in it["forum"])]
        if hit:
            items = hit
    items = dedupe(items)
    return {"ok": True, "site": "tieba", "items": sort_items(items, sort), "page": page,
            "has_more": bool(payload.get("has_more")) and len(items) >= 15,
            "nocookie": True}


def tieba_search(kw, q, page=1):
    """kw=吧名（可空=全站），q=关键词"""
    url = ("https://tieba.baidu.com/f/search/res?ie=utf-8&qw=%s&rn=20&pn=%d"
           % (quote(q), page))
    if kw:
        url = ("https://tieba.baidu.com/f/search/res?ie=utf-8&kw=%s&qw=%s&rn=20&pn=%d"
               % (quote(kw), quote(q), page))
    conf = load_conf()
    r = fetch(url, cookie=conf["tieba_cookie"], referer="https://tieba.baidu.com/",
              ua=UA_PC, timeout=conf["timeout"])
    text = r["text"]
    if r["status"] != 200:
        debug = save_debug("tieba", "search", text)
        return {"ok": False, "site": "tieba", "code": r["status"],
                "error": r.get("err") or ("HTTP %s" % r["status"]), "debug": debug,
                "items": []}
    wall = looks_like_login_wall("tieba", text)
    if wall and "/p/" not in text:
        debug = save_debug("tieba", "search", text)
        return {"ok": False, "site": "tieba", "code": r["status"], "error": wall,
                "debug": debug, "items": []}

    items = []
    seen = set()
    # 优先按 s_post 块切
    blocks = re.split(r'(?=<div[^>]*class="[^"]*s_post\b)', text)
    for b in blocks:
        if "s_post" not in b[:200]:
            continue
        m_tid = re.search(r"/p/(\d+)", b)
        if not m_tid:
            continue
        tid = m_tid.group(1)
        if tid in seen:
            continue
        m_title = re.search(r'class="p_title"[^>]*>\s*(?:<[^>]+>\s*)*<a[^>]*>(.*?)</a>', b, re.S)
        title = html2text(m_title.group(1)) if m_title else ""
        if not title:
            m_title = re.search(r'<a[^>]+/p/%s[^>]*>(.*?)</a>' % tid, b, re.S)
            title = html2text(m_title.group(1)) if m_title else "（无标题）"
        m_cont = re.search(r'class="p_content"[^>]*>(.*?)</p>', b, re.S)
        brief = html2text(m_cont.group(1)) if m_cont else ""
        m_date = re.search(r'class="p_date"[^>]*>(.*?)<', b, re.S)
        date = html2text(m_date.group(1)) if m_date else ""
        m_auth = re.search(r'class="p_author"[^>]*>(.*?)</', b, re.S)
        author = html2text(m_auth.group(1)) if m_auth else ""
        m_forum = re.search(r'class="p_forum"[^>]*>(.*?)</', b, re.S)
        forum = html2text(m_forum.group(1)) if m_forum else kw
        seen.add(tid)
        items.append({
            "site": "tieba", "tid": tid, "title": title or "（无标题）",
            "brief": brief[:220], "date": date, "author": author, "forum": forum,
            "url": "https://tieba.baidu.com/p/%s" % tid,
            "reply": (re.search(r'(\d+)\s*条回复', b).group(1) if re.search(r'(\d+)\s*条回复', b) else ""),
        })

    # 兜底：全局扫 /p/ 链接
    if not items:
        for m in re.finditer(r'<a[^>]+href="[^"]*?/p/(\d+)[^"]*"[^>]*>(.*?)</a>', text, re.S):
            tid, t = m.group(1), html2text(m.group(2))
            if tid in seen or len(t) < 4:
                continue
            seen.add(tid)
            items.append({"site": "tieba", "tid": tid, "title": t, "brief": "", "date": "",
                          "author": "", "forum": kw,
                          "url": "https://tieba.baidu.com/p/%s" % tid, "reply": ""})
    return {"ok": True, "site": "tieba", "items": items, "page": page,
            "has_more": len(items) >= 10}


def tieba_thread(tid, see_lz=False, pages=1, start_page=1):
    conf = load_conf()
    floors = []
    title = ""
    total_pages = None
    last_err = ""
    for pn in range(start_page, start_page + max(1, pages)):
        url = "https://tieba.baidu.com/p/%s?pn=%d%s" % (
            tid, pn, "&see_lz=1" if see_lz else "")
        r = fetch(url, cookie=conf["tieba_cookie"],
                  referer="https://tieba.baidu.com/p/%s" % tid,
                  ua=UA_PC, timeout=conf["timeout"])
        text = r["text"]
        if r["status"] != 200:
            last_err = r.get("err") or ("HTTP %s" % r["status"])
            if not floors:
                save_debug("tieba", "thread", text)
            break
        wall = looks_like_login_wall("tieba", text)
        if wall and "l_post" not in text:
            last_err = wall
            save_debug("tieba", "thread", text)
            break
        if not title:
            m = re.search(r'<h1[^>]*class="[^"]*core_title_txt[^"]*"[^>]*title="([^"]*)"', text)
            if not m:
                m = re.search(r"<title>(.*?)</title>", text, re.S)
            if m:
                title = html2text(m.group(1))
                title = re.sub(r"[_\-—]*(百度贴吧|贴吧)$", "", title).strip()
        if total_pages is None:
            m = re.search(r"共\s*(\d+)\s*页", text)
            if m:
                total_pages = int(m.group(1))

        got = parse_tieba_floors(text)
        if not got:
            break
        floors.extend(got)
        if total_pages and pn >= total_pages:
            break
        time.sleep(0.35)

    op = next((f for f in floors if f.get("is_op")), floors[0] if floors else None)
    op_uid = (op or {}).get("uid", "")
    op_name = (op or {}).get("author", "")
    if see_lz and op_uid:
        # 二次过滤保险
        floors = [f for f in floors if f.get("uid") == op_uid]
    return {"ok": bool(floors) or not last_err, "site": "tieba", "tid": tid,
            "title": title or ("贴吧帖子 %s" % tid), "op": op_name, "op_uid": op_uid,
            "floors": floors, "total_pages": total_pages,
            "url": "https://tieba.baidu.com/p/%s" % tid,
            "error": last_err}


def loose_tieba_field(raw):
    """data-field JSON 损坏时的兜底抽取"""
    def g(k):
        m = re.search(r'"%s"\s*:\s*(\d+)' % k, raw)
        return m.group(1) if m else ""
    def s(k):
        m = re.search(r'"%s"\s*:\s*"((?:[^"\\]|\\.)*)"' % k, raw)
        if not m:
            m = re.search(r'"%s"\s*:\s*"(.*?)"\s*,\s*"' % k, raw)
        return unescape(m.group(1)).replace('\\"', '"') if m else ""
    name = s("user_name")
    body = s("post_content")
    if not name and not body:
        return None
    return {
        "author": {"user_name": name, "user_id": g("user_id")},
        "content": {"post_content": body, "post_id": g("post_id"),
                    "post_no": g("post_no")},
        "date": s("date"),
        "floor": "",
    }


def parse_tieba_floors(text):
    out = []
    for m in re.finditer(r"data-field='(.*?)'(?=\s|>)", text, re.S):
        raw = m.group(1)
        try:
            data = json.loads(raw)
        except Exception:
            try:
                data = json.loads(unescape(raw))
            except Exception:
                data = loose_tieba_field(raw)
                if not data:
                    continue
        author = data.get("author") or {}
        content = data.get("content") or {}
        text_html = content.get("post_content") or ""
        if not text_html and not author:
            continue
        name = author.get("user_name") or author.get("name_show") or ""
        uid = str(author.get("user_id") or "")
        fl = str(data.get("floor") or content.get("post_no") or "")
        cid = str(content.get("post_id") or "")
        date = data.get("date") or ""
        is_op = bool(author.get("is_lz")) or fl in ("1", "楼主")
        body = html2text(text_html)
        if not body and not name:
            continue
        out.append({
            "floor": fl or "?",
            "author": name or "匿名",
            "uid": uid,
            "pid": cid,
            "time": date,
            "text": body,
            "is_op": is_op,
            "raw_len": len(text_html),
        })
    # 去重
    seen = set()
    ded = []
    for f in out:
        k = (f["pid"], f["floor"], f["text"][:60])
        if k in seen:
            continue
        seen.add(k)
        ded.append(f)
    return ded


# ----------------------------------------------------------------------------- NGA
def nga_search(key, page=1, sort="rel"):
    conf = load_conf()
    url = "https://bbs.nga.cn/thread.php?key=%s&fid=-1&page=%d" % (quote(key), page)
    r = fetch(url, cookie=conf["nga_cookie"], referer="https://bbs.nga.cn/",
              ua=UA_PC, timeout=conf["timeout"])
    text = r["text"]
    if r["status"] != 200:
        debug = save_debug("nga", "search", text)
        return {"ok": False, "site": "nga", "code": r["status"],
                "error": r.get("err") or ("HTTP %s" % r["status"]), "debug": debug,
                "items": []}
    wall = looks_like_login_wall("nga", text)
    if wall:
        debug = save_debug("nga", "search", text)
        return {"ok": False, "site": "nga", "code": r["status"], "error": wall,
                "debug": debug, "items": []}

    items, seen = [], set()
    row_re = re.compile(r"<a[^>]+href=['\"]?/?(?:read\.php)\?tid=(\d+)[^'\">]*['\"][^>]*>(.*?)</a>", re.S)
    for m in row_re.finditer(text):
        tid, inner = m.group(1), m.group(2)
        if tid in seen:
            continue
        title = html2text(inner)
        if len(title) < 2:
            continue
        seen.add(tid)
        items.append({"site": "nga", "tid": tid, "title": title, "brief": "", "date": "",
                      "author": "", "forum": "",
                      "url": "https://bbs.nga.cn/read.php?tid=%s" % tid, "reply": ""})
    # 补日期/作者：按 tr 行切
    by_tid = {it["tid"]: it for it in items}
    for row in re.split(r"(?=<tr)", text):
        m_tid = re.search(r"tid=(\d+)", row)
        if not m_tid or m_tid.group(1) not in by_tid:
            continue
        it = by_tid[m_tid.group(1)]
        if not it["date"]:
            m = re.search(r"(\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{2})", row)
            if m:
                it["date"] = m.group(1)
        if not it["author"]:
            m = re.search(r"func=ucp&uid=\d+['\"][^>]*>(.*?)</a>", row, re.S)
            if m:
                it["author"] = html2text(m.group(1))
        if not it["forum"]:
            m = re.search(r"func=forum&fid=-?\d+['\"][^>]*>(.*?)</a>", row, re.S)
            if m:
                it["forum"] = html2text(m.group(1))
    items = dedupe(items)
    return {"ok": True, "site": "nga", "items": sort_items(items, sort), "page": page,
            "has_more": len(items) >= 10}


def nga_thread(tid, see_lz=False, pages=1, start_page=1):
    conf = load_conf()
    floors, title, total_pages, last_err = [], "", None, ""
    op_uid = ""

    def one(pn, authorid=""):
        url = "https://bbs.nga.cn/read.php?tid=%s&page=%d" % (tid, pn)
        if authorid:
            url += "&authorid=%s" % authorid
        return url

    # 第一页先探楼主
    r0 = fetch(one(start_page), cookie=conf["nga_cookie"],
               referer="https://bbs.nga.cn/read.php?tid=%s" % tid,
               ua=UA_PC, timeout=conf["timeout"])
    t0 = r0["text"]
    if r0["status"] != 200:
        save_debug("nga", "thread", t0)
        return {"ok": False, "site": "nga", "tid": tid, "floors": [], "title": "",
                "error": r0.get("err") or ("HTTP %s" % r0["status"]), "op": "", "op_uid": ""}
    wall = looks_like_login_wall("nga", t0)
    if wall:
        save_debug("nga", "thread", t0)
        return {"ok": False, "site": "nga", "tid": tid, "floors": [], "title": "",
                "error": wall, "op": "", "op_uid": ""}

    first = parse_nga_floors(t0)
    if first:
        op_uid = first[0].get("uid", "")
    m = re.search(r'<h1[^>]*id=["\']postsubject\d*["\'][^>]*>(.*?)</h1>', t0, re.S)
    if not m:
        m = re.search(r"<title>(.*?)</title>", t0, re.S)
    if m:
        title = html2text(m.group(1))
        title = re.sub(r"[_\-—]*\s*NGA玩家社区.*$", "", title).strip()
    m = re.search(r"共\s*(\d+)\s*页", t0) or re.search(r"pagecount[^>]*>(\d+)<", t0)
    if m:
        total_pages = int(m.group(1))

    use_author = see_lz and op_uid
    pages_data = {start_page: t0 if not use_author else None}

    todo = list(range(start_page, start_page + max(1, pages)))
    if use_author:
        pages_data[start_page] = None  # 需要重抓

    def work(pn):
        if pages_data.get(pn):
            return pn, pages_data[pn]
        r = fetch(one(pn, op_uid if use_author else ""), cookie=conf["nga_cookie"],
                  referer="https://bbs.nga.cn/read.php?tid=%s" % tid,
                  ua=UA_PC, timeout=conf["timeout"])
        return pn, r["text"] if r["status"] == 200 else ""

    with ThreadPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(work, todo))
    results.sort(key=lambda x: x[0])
    for pn, txt in results:
        if not txt:
            last_err = "部分页抓取失败（可能页数超限或被限流）"
            continue
        got = parse_nga_floors(txt)
        floors.extend(got)
        time.sleep(0.05)

    if see_lz and op_uid:
        floors = [f for f in floors if f.get("uid") == op_uid or f.get("is_op")]
    # 去重
    seen, ded = set(), []
    for f in floors:
        k = f.get("pid") or (f["floor"], f["author"], f["text"][:40])
        if k in seen:
            continue
        seen.add(k)
        ded.append(f)

    op_name = next((f["author"] for f in ded if f.get("is_op")), ded[0]["author"] if ded else "")
    return {"ok": bool(ded) or not last_err, "site": "nga", "tid": tid,
            "title": title or ("NGA 帖子 %s" % tid), "op": op_name, "op_uid": op_uid,
            "floors": ded, "total_pages": total_pages,
            "url": "https://bbs.nga.cn/read.php?tid=%s" % tid, "error": last_err}


def parse_nga_floors(text):
    out = []
    anchors = list(re.finditer(r"<div[^>]*id=[\"']postcontent_(\d+)[\"'][^>]*>", text))
    for i, m in enumerate(anchors):
        pid = m.group(1)
        seg, end = slice_balanced(text, m.start())
        inner = re.sub(r"^<div[^>]*>", "", seg)
        inner = re.sub(r"</div>\s*$", "", inner)
        body = html2text(inner)
        # 作者信息：从上一个锚点结束 到 本次锚点开始
        prev_end = slice_balanced(text, anchors[i - 1].start())[1] if i > 0 else 0
        meta = text[prev_end:m.start()]
        uid = ""
        name = ""
        mu = re.findall(r"func=ucp&(?:amp;)?uid=(\d+)", meta)
        if mu:
            uid = mu[-1]
        ma = re.search(r"class=[\"']author[\"'][^>]*>(.*?)</a>", meta, re.S)
        if ma:
            name = html2text(ma.group(1))
        else:
            mu2 = re.findall(r"func=ucp&(?:amp;)?uid=\d+[\"'][^>]*>(.*?)</a>", meta, re.S)
            if mu2:
                name = html2text(mu2[-1])
        mt = re.search(r"(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})", meta)
        ftime = mt.group(1) if mt else ""
        mf = re.search(r"#(\d+)", meta)
        floor = mf.group(1) if mf else str(i)
        if not body and not name:
            continue
        out.append({"floor": floor, "author": name or "匿名", "uid": uid, "pid": pid,
                    "time": ftime, "text": body, "is_op": False, "raw_len": len(inner)})
    if out:
        out[0]["is_op"] = True
    return out


# ----------------------------------------------------------------------------- 服务
def parse_tid(site, raw):
    raw = (raw or "").strip()
    if not raw:
        return ""
    m = re.search(r"(?:tid=|/p/|thread-)(\d+)", raw)
    if m:
        return m.group(1)
    if raw.isdigit():
        return raw
    return ""


class Handler(BaseHTTPRequestHandler):
    server_version = "FanficHunter/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    # ---- 基础响应
    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-store")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False))

    def do_OPTIONS(self):
        self._send(204, b"")

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        path = u.path

        if path in ("/", "/index.html"):
            fp = os.path.join(BASE, "index.html")
            if not os.path.exists(fp):
                return self._send(404, "index.html missing", "text/plain; charset=utf-8")
            with open(fp, "rb") as f:
                return self._send(200, f.read(), "text/html; charset=utf-8")

        if path == "/api/ping":
            return self._json({"ok": True, "ts": int(time.time()), "port": PORT})

        if path == "/api/conf":
            c = load_conf()
            return self._json({
                "ok": True,
                "tieba_cookie": c["tieba_cookie"],
                "nga_cookie": c["nga_cookie"],
                "has_tieba": bool(c["tieba_cookie"]),
                "has_nga": bool(c["nga_cookie"]),
            })

        if path == "/api/qr":
            try:
                return self._json(baidu_qr_new())
            except Exception as e:
                return self._json({"ok": False, "error": "二维码异常: %s" % e})

        if path == "/api/qr/poll":
            sign = (qs.get("sign", [""])[0] or "").strip()
            if not sign:
                return self._json({"ok": False, "error": "缺少 sign"})
            try:
                res = baidu_qr_poll(sign)
            except Exception as e:
                return self._json({"ok": True, "state": "wait", "warn": str(e)})
            if res.get("state") == "done":
                bduss = res.get("bduss") or ""
                user = verify_bduss(bduss) if bduss else ""
                c = load_conf()
                c["tieba_cookie"] = merge_bduss(c.get("tieba_cookie", ""), bduss)
                save_conf(c)
                res["saved"] = True
                res["user"] = user
                if not user:
                    res["warn"] = "BDUSS 已保存，但没能验证出用户名（可能贴吧侧限流）"
            return self._json(res)

        if path == "/api/search":
            site = (qs.get("site", ["tieba"])[0] or "tieba").lower()
            kw = qs.get("kw", [""])[0].strip()
            q = qs.get("q", [""])[0].strip()
            page = int(qs.get("page", ["1"])[0] or 1)
            sort = (qs.get("sort", ["rel"])[0] or "rel").lower()
            if sort not in SORTS:
                sort = "rel"
            if not q:
                return self._json({"ok": False, "error": "关键词为空", "items": []})
            try:
                if site == "tieba":
                    res = tieba_mobile_search(q, page, kw, sort)
                    if not res.get("ok") or not res.get("items"):
                        alt = tieba_search(kw, q, page)   # 旧 PC 接口兜底
                        if alt.get("ok") and alt.get("items"):
                            alt["items"] = sort_items(dedupe(alt["items"]), sort)
                            res = alt
                else:
                    res = nga_search(q, page, sort)
            except Exception as e:
                return self._json({"ok": False, "error": "解析异常: %s" % e, "items": []})
            return self._json(res)

        if path == "/api/thread":
            site = (qs.get("site", ["tieba"])[0] or "tieba").lower()
            tid = parse_tid(site, qs.get("tid", [""])[0])
            see_lz = qs.get("see_lz", ["0"])[0] in ("1", "true", "yes")
            pages = int(qs.get("pages", ["1"])[0] or 1)
            start = int(qs.get("page", ["1"])[0] or 1)
            if not tid:
                return self._json({"ok": False, "error": "帖子 ID 无效", "floors": []})
            try:
                if site == "tieba":
                    res = tieba_thread(tid, see_lz, pages, start)
                else:
                    res = nga_thread(tid, see_lz, pages, start)
            except Exception as e:
                import traceback
                traceback.print_exc()
                return self._json({"ok": False, "error": "抓取异常: %s" % e, "floors": []})
            return self._json(res)

        if path == "/api/debug":
            fn = qs.get("f", [""])[0]
            safe = os.path.basename(fn)
            fp = os.path.join(DBG_DIR, safe)
            if os.path.exists(fp):
                with open(fp, "rb") as f:
                    return self._send(200, f.read(), "text/html; charset=utf-8")
            return self._send(404, "no such debug file", "text/plain")

        return self._send(404, "not found", "text/plain; charset=utf-8")

    def do_POST(self):
        u = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            data = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            data = {}

        if u.path == "/api/conf":
            c = load_conf()
            cleaned = {}
            for site, key in (("tieba", "tieba_cookie"), ("nga", "nga_cookie")):
                if key not in data:
                    continue
                raw = (data.get(key) or "").strip()
                if not raw:
                    c[key] = ""
                    cleaned[key] = False
                    continue
                s = sanitize_cookie(site, raw)
                c[key] = s or raw
                cleaned[key] = bool(s)
            save_conf(c)
            return self._json({"ok": True, "has_tieba": bool(c["tieba_cookie"]),
                               "has_nga": bool(c["nga_cookie"]),
                               "parsed": cleaned, "conf": c})

        if u.path == "/api/save":
            name = (data.get("name") or "fanfic_%s.txt" % time.strftime("%m%d_%H%M%S"))
            name = re.sub(r"[\\/:*?\"<>|]+", "_", name)
            if not name.lower().endswith(".txt"):
                name += ".txt"
            content = data.get("content") or ""
            fp = os.path.join(OUT_DIR, name)
            with open(fp, "w", encoding="utf-8") as f:
                f.write(content)
            return self._json({"ok": True, "path": fp, "size": len(content.encode("utf-8")),
                               "android_path": fp.replace(BASE, "/sdcard/Download/Operit/fanfic-hunter")})

        return self._send(404, "not found", "text/plain")


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    print("=" * 58)
    print(" FANFIC HUNTER // 同人文猎手")
    print(" -> http://127.0.0.1:%d" % PORT)
    print(" -> conf: %s" % CONF_PATH)
    print("=" * 58)
    sys.stdout.flush()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
