#!/bin/sh
# 起本地静态服务（pdf.js 的 worker 需要 http，不能用 file://）
cd "$(dirname "$0")" || exit 1
echo "🐋 打开浏览器访问 http://127.0.0.1:8080/"
exec python3 -m http.server 8080
