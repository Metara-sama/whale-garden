#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
trend-lab 本地抓取桥
====================================================================
静态页在浏览器里直接 fetch 百度/B站/微博 会被 CORS 拦掉，
公共代理又大多已经关门。这个 30 行级别的小服务把「抓取」挪到本机，
只负责：收到请求 → 拉一次官方榜单 → 原样吐 JSON + 加上 CORS 头。

用法
----
    python3 tools/bridge.py                      # 只本机可访问（页面和桥在同一台设备）
    python3 tools/bridge.py --host 0.0.0.0       # 局域网也能访问（手机开页面、电脑跑桥）
    python3 tools/bridge.py --port 8899          # 换端口

然后在页面「今日实时快照 → 抓不到？」里把「本地桥地址」填成
    http://127.0.0.1:8899                （同机）
    http://192.168.x.x:8899              （另一台设备跑桥）

接口
----
    GET /ping                  → {"ok":true,"sources":[...]}
    GET /hot?p=baidu           → 百度热搜原始 JSON
    GET /hot?p=bilibili        → B站热词原始 JSON
    GET /hot?p=weibo           → 微博热搜原始 JSON

只读、不落盘、不记录任何参数以外的东西。
"""
import argparse
import json
import sys
import threading
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

SOURCES = {
    "baidu": "https://top.baidu.com/api/board?platform=wise&tab=realtime",
    "bilibili": "https://s.search.bilibili.com/main/hotword",
    "weibo": "https://weibo.com/ajax/side/hotSearch",
}

UA = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36")


def fetch_source(pid, timeout=8):
    url = SOURCES[pid]
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://weibo.com/" if pid == "weibo" else url.split("/api")[0] + "/",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


CACHE = {}          # pid -> (ts, body)
CACHE_TTL = 120.0   # 秒；连点两次只打一次上游


def get_source(pid):
    import time
    now = time.time()
    hit = CACHE.get(pid)
    if hit and now - hit[0] < CACHE_TTL:
        return hit[1], True
    last = None
    for attempt in range(2):          # 上游偶发抖动就再打一次
        try:
            body = fetch_source(pid)
            CACHE[pid] = (time.time(), body)
            return body, False
        except Exception as e:        # noqa: BLE001
            last = e
            if attempt == 0:
                import time as _t
                _t.sleep(0.6)
    raise last


class Handler(BaseHTTPRequestHandler):
    server_version = "trend-lab-bridge/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("[bridge] " + (fmt % args) + "\n")

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        # Chrome 对「公网页面访问本机」会做 PNA 预检
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_OPTIONS(self):
        self._send(204, b"")

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ("/ping", "/"):
            return self._send(200, json.dumps(
                {"ok": True, "name": "trend-lab-bridge", "version": "1.1",
                 "sources": list(SOURCES)},
                ensure_ascii=False))
        if u.path == "/hot":
            pid = (parse_qs(u.query).get("p") or [""])[0]
            if pid not in SOURCES:
                return self._send(400, json.dumps(
                    {"error": "unknown source", "sources": list(SOURCES)}, ensure_ascii=False))
            try:
                body, cached = get_source(pid)
            except urllib.error.HTTPError as e:
                return self._send(502, json.dumps(
                    {"error": "upstream HTTP %s" % e.code, "source": pid}, ensure_ascii=False))
            except Exception as e:
                return self._send(502, json.dumps(
                    {"error": "%s: %s" % (type(e).__name__, e), "source": pid}, ensure_ascii=False))
            return self._send(200, body)
        return self._send(404, json.dumps({"error": "not found"}, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser(description="trend-lab 本地抓取桥")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8899)
    a = ap.parse_args()
    srv = ThreadingHTTPServer((a.host, a.port), Handler)

    # 启动就把三源预热一次：页面点「测一下」之后抓取基本都命中缓存
    def warm():
        for pid in SOURCES:
            try:
                get_source(pid)
                print("  warm ✓ " + pid)
            except Exception as e:      # noqa: BLE001
                print("  warm ✗ %s (%s)" % (pid, e))
    threading.Thread(target=warm, daemon=True).start()

    print("trend-lab bridge → http://%s:%d" % (a.host, a.port))
    print("  自检: curl http://127.0.0.1:%d/ping" % a.port)
    print("  页面里填: http://127.0.0.1:%d" % a.port)
    print("  Ctrl+C 退出")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
        srv.server_close()


if __name__ == "__main__":
    main()