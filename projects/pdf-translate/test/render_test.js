/* 嵌字排版测试：用假 canvas + 真实 PDF 解析结果，验证自适应字号/换行/不越界
 * 用法：NODE_PATH=/tmp/ptest/node_modules node render_test.js <pdf> <页号>
 */
const fs = require('fs');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
global.window = global;
new Function('window', fs.readFileSync('/sdcard/Download/Operit/paper_translate/js/render.js', 'utf8'))(global);
new Function('window', fs.readFileSync('/sdcard/Download/Operit/paper_translate/js/pdfparse.js', 'utf8'))(global);
global.pdfjsLib = pdfjs;

function fakeCtx(W, H) {
  const calls = [];
  return {
    canvas: { width: W, height: H },
    font: '400 10px x',
    calls,
    measureText(s) {
      const m = this.font.match(/([\d.]+)px/);
      const fs0 = m ? parseFloat(m[1]) : 10;
      let w = 0;
      for (const ch of s) w += /[\u2E80-\u9FFF\uFF00-\uFFEF]/.test(ch) ? fs0 : fs0 * 0.52;
      return { width: w };
    },
    fillRect() { },
    fillText(t, x, y) { calls.push({ t, x, y, font: +this.font.match(/([\d.]+)px/)[1] }); },
    getImageData(x, y, w, h) {
      const n = Math.max(4, Math.floor(Math.abs(w)) * Math.floor(Math.abs(h)) * 4);
      const a = new Uint8ClampedArray(n);
      a.fill(255);
      return { data: a };
    }
  };
}

// 粗略“翻译”：长度按 0.55 折算成中文
function fakeTrans(text) {
  const target = Math.max(3, Math.round(text.replace(/\s+/g, '').length * 0.55));
  const pool = '在钼钒铌碲氧化物催化剂表面活性位点的表征研究中我们发现丙烯酸选择性与晶相组成密切相关';
  let out = '';
  while (out.length < target) out += pool;
  return out.slice(0, target);
}

(async () => {
  const pdfPath = process.argv[2];
  const pn = Number(process.argv[3] || 2);
  const S = 2.5;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)) }).promise;
  const p = await PDFParse.analyzePage(doc, pn, { skipFormula: true });
  p.segs.forEach(s => { if (!s.skip) s.trans = fakeTrans(s.text); });

  const ctx = fakeCtx(Math.round(p.w * S), Math.round(p.h * S));
  const stat = PaperRender.drawSegs(ctx, p.segs, S, { mode: 'replace', smartBg: true, fontScale: 1, autoFill: true });
  console.log('page', pn, 'segs', p.segs.length, 'stat', JSON.stringify(stat), 'fillText calls', ctx.calls.length);
  if (!ctx.calls.length) { console.log('⚠ 没有任何文字被写入'); process.exit(0); }

  const maxY = Math.max(...ctx.calls.map(c => c.y));
  const minY = Math.min(...ctx.calls.map(c => c.y));
  console.log('文字 y 范围:', minY.toFixed(1), '~', maxY.toFixed(1), ' 页面高:', (p.h * S).toFixed(1));
  if (maxY > p.h * S) console.log('  ⚠ 有文字超出页面底部');

  let minScale = 9;
  const byId = new Map(p.segs.map(s => [s.id, s]));
  const overList = stat.detail.filter(d => d.over);
  stat.detail.forEach(d => {
    const s = byId.get(d.id);
    if (!s) return;
    minScale = Math.min(minScale, d.fs / (Math.max(4.5, s.fontSize) * S));
  });
  console.log('引擎报告：溢出块', overList.length, '/', stat.detail.length, ' 最小字号/原字号:', minScale.toFixed(2));
  overList.slice(0, 3).forEach(d => {
    const s = byId.get(d.id);
    console.log(`  [溢出] ${d.id} 行数=${d.lines} 末行=${d.last} 上限=${d.limit} fs=${d.fs} 原文${s ? s.text.length : '?'}字 译文${s ? s.trans.length : '?'}字 avail=${s ? s.availH.toFixed(1) : '?'}pt`);
  });
  p.segs.filter(s => !s.skip && s.trans).slice(1, 3).forEach(s => {
    console.log(`  样本 x=${s.x0.toFixed(0)} y=${s.yTop.toFixed(0)} w=${s.w.toFixed(0)} h=${s.h.toFixed(0)} avail=${s.availH.toFixed(0)} 原文${s.text.length}字 → 译文${s.trans.length}字`);
  });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });