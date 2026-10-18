# PDF 拆分 · 合并

Whale's Garden 里的 PDF 小工具：拖进 PDF，拆开、拼上、重排、转个角度，全在浏览器内存里完成，一个字节都不上传。

页面：`projects/pdf-kit/index.html`

## 能干什么

- **合并**：多份 PDF 依次载入，工位里的页按当前顺序拼成一份。
- **拆分**：三种模式 —— 按范围（`1-3,5,8-`，逗号分段、一段一份）、每 N 页一份、每页一份；多份输出自动打成 ZIP。
- **重排**：按住页卡右上角 `⠿` 拖动换位，或「反转顺序」。
- **选页**：点卡片、全选 / 反选 / 奇偶页 / 按编号（支持 `-1` 倒数第一页、`-3--1`）。
- **旋转**：选中页各转 90°，写进导出文件。
- **删除 / 恢复**：删除只是把页移出工位，源文件还在列表里，点 `↺` 可整份放回。
- **预览**：卡片右下角 `⤢` 看大图。

快捷键：`Ctrl+O` 载入、`Ctrl+A` 全选、`Ctrl+S` 导出全部、`Del` 删除选中页、`Esc` 取消选择 / 关大图。

## 结构

```
pdf-kit/
├── index.html
├── css/style.css
├── js/app.js      # 主逻辑：工位、选择、缩略图流水线、合并/拆分、ZIP
├── js/zip.js      # 极简 ZIP（store 模式，零依赖，CRC32 自己算）
├── lib/           # pdf-lib 1.17.1 / PDF.js 3.11.174（自托管，不走 CDN）
└── test/          # 样例 PDF + 三个自测脚本
```

## 关键实现

- PDF.js 负责**看**：缩略图用 `IntersectionObserver` 懒渲染、串行排队，避免一次开几十个 canvas 把内存打爆。
- pdf-lib 负责**写**：按文件分组一次 `out.copyPages(src, indices)` 批量取页（同一页被排多次时退回逐页复制，否则多个位置会引用同一个页面对象），再按工位顺序 `addPage`。
- 传给 PDF.js 的是字节的**副本**：它会 `transfer` 给 worker，原 buffer 会被 detach，之后 pdf-lib 还得用。
- 进度条按「已 addPage 的页数 / 总页数」驱动，取消按钮在每页之间检查，能真停下来。

## 自测

```sh
node test/mksample.js     # 生成 sample-12p.pdf / sample-3p.pdf
node test/logic_test.js   # 复制/旋转/拆分/ZIP 的产物写到 /tmp，用 pypdf 校验
node test/dom_test.js     # jsdom 跑一遍真实交互（需要 jsdom）
```

本地预览：

```sh
python3 -m http.server 18800 --bind 127.0.0.1
# http://127.0.0.1:18800/projects/pdf-kit/
```
