/* 自测：pdf-lib 的复制/旋转/拆分逻辑 + zip.js 打包 */
const fs = require('fs');
const path = require('path');

global.window = global;
const PL = require(path.join(__dirname, '../lib/pdf-lib.min.js'));
require(path.join(__dirname, '../js/zip.js'));

const { PDFDocument, StandardFonts, degrees, rgb } = PL;

(async () => {
  // 1. 造一个 12 页的测试 PDF，每页写自己的页码
  const src = await PDFDocument.create();
  const font = await src.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 12; i++) {
    const p = src.addPage([300, 400]);
    p.drawText('PAGE ' + i, { x: 60, y: 320, size: 36, font, color: rgb(0, 0, 0) });
  }
  const srcBytes = await src.save();
  fs.writeFileSync('/tmp/src.pdf', srcBytes);
  console.log('源文件：12 页，', srcBytes.length, 'bytes');

  // 2. 复刻 buildPdf 的核心：分组批量复制 + 旋转
  async function build(list) {
    const out = await PDFDocument.create();
    const buckets = {};
    const groups = [];
    const map = {};
    list.forEach((e) => {
      if (!map[e.fid]) { map[e.fid] = { fid: e.fid, items: [] }; groups.push(map[e.fid]); }
      map[e.fid].items.push(e);
    });
    for (const g of groups) {
      const s = await PDFDocument.load(srcBytes, { ignoreEncryption: true, updateMetadata: false });
      const idx = [];
      const seen = {};
      g.items.forEach((it) => { if (!seen[it.pageIdx]) { seen[it.pageIdx] = 1; idx.push(it.pageIdx); } });
      const dup = idx.length !== g.items.length;
      if (!dup) {
        const pages = await out.copyPages(s, idx);
        const m = {};
        idx.forEach((pi, k) => { m[pi] = [pages[k]]; });
        buckets[g.fid] = m;
      } else {
        const m2 = {};
        for (const it of g.items) {
          const ps = await out.copyPages(s, [it.pageIdx]);
          if (!m2[it.pageIdx]) m2[it.pageIdx] = [];
          m2[it.pageIdx].push(ps[0]);
        }
        buckets[g.fid] = m2;
      }
    }
    for (const e of list) {
      const b = buckets[e.fid] && buckets[e.fid][e.pageIdx];
      const p = b && b.shift();
      if (!p) throw new Error('missing page ' + JSON.stringify(e));
      if (e.rot) {
        const cur = (p.getRotation() && p.getRotation().angle) || 0;
        p.setRotation(degrees(((cur + e.rot) % 360 + 360) % 360));
      }
      out.addPage(p);
    }
    return out.save({ useObjectStreams: true });
  }

  const E = (i, rot = 0) => ({ fid: 'f1', pageIdx: i, rot });

  // 3. 场景 A：乱序 + 重复页 + 旋转
  const a = await build([E(11), E(0, 90), E(4), E(0, 90), E(7, 180)]);
  fs.writeFileSync('/tmp/out-a.pdf', a);
  console.log('A 输出：', a.length, 'bytes');

  // 4. 场景 B：各种拆分分组
  const all = Array.from({ length: 12 }, (_, i) => E(i));
  const groups = [[0, 1, 2], [4], [7, 8, 9, 10, 11]];
  const outs = [];
  for (let i = 0; i < groups.length; i++) {
    const bytes = await build(groups[i].map((k) => all[k]));
    outs.push({ name: '拆分-00' + (i + 1) + '.pdf', data: bytes });
    fs.writeFileSync('/tmp/split-' + i + '.pdf', bytes);
  }
  console.log('B 拆分：' + outs.length + ' 份');

  // 5. 用 zip.js 打包
  const blob = window.WhaleZip.store(outs);
  const buf = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync('/tmp/split.zip', buf);
  console.log('ZIP：', buf.length, 'bytes');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
