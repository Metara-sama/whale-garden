#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地调试服：禁用缓存（改完代码刷新就生效，不会被浏览器缓存骗）。"""
import functools
import http.server

ROOT = '/sdcard/Download/Operit/whale-garden'


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 18801), functools.partial(Handler, directory=ROOT))
    print('serving %s on http://127.0.0.1:18801 (no-store)' % ROOT)
    httpd.serve_forever()