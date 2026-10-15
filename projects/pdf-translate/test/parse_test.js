/* 离线解析测试：用真实 PDF 跑 分行/分栏/切块，检查坐标是否合理
 * 用法：cd /tmp/ptest && node /sdcard/Download/Operit/paper_translate/test/parse_test.js <pdf路径> [页号...]
 */
const fs = require('fs');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

global.window = global;
// 载入页面里用的解析脚本
const SRC = '/sdcard/Download/Operit/paper_translate/js/pdfparse.js';
new Function('window', fs.readFileSync(SRC, 'utf8'))(global);
global.pdfjsLib = pdfjs;

(async () => {
  const pdfPath = process.argv[2] || '/sdcard/Download/10.1016@j.cattod.2010.06.015.pdf';
  const pages = process.argv.slice(3).map(Number);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)) }).promise;
  console.log('文件:', pdfPath, '总页数:', doc.numPages);
  const list = pages.length ? pages : [1, 2];
  for (const pn of list) {
    const p = await PDFParse.analyzePage(doc, pn, { skipFormula: true, keepNumbers: false, maxChars: 400 });
    const segs = p.segs;
    const skip = segs.filter(s => s.skip).length;
    console.log(`\n=== P${pn} 页面 ${p.w.toFixed(0)}x${p.h.toFixed(0)} 双栏=${!!p.dual} 块=${segs.length} 跳过=${skip} ===`);
    console.log('  [dbg]', JSON.stringify(p._dbg));
    // 统计：
    const bad = segs.filter(s => !(s.x0 >= -2 && s.x1 <= p.w + 2 && s.yTop >= -2 && s.yBottom <= p.h + 2));
    const weird = segs.filter(s => s.fontSize < 4 || s.fontSize > 40);
    if (bad.length) console.log('  ⚠ 越界块:', bad.length, JSON.stringify(bad[0].text.slice(0, 40)));
    if (weird.length) console.log('  ⚠ 字号异常块:', weird.length, weird.map(s => s.fontSize.toFixed(1)).join(','));
    segs.forEach((s, i) => {
      if (i < 12) {
        console.log(`  #${i} ${s.col} fs=${s.fontSize.toFixed(1)} x=${s.x0.toFixed(0)} y=${s.yTop.toFixed(0)} w=${s.w.toFixed(0)} h=${s.h.toFixed(0)} avail=${s.availH.toFixed(0)}${s.skip ? ' [跳过:' + s.skipReason + ']' : ''}`);
        console.log('      ' + JSON.stringify(s.text.slice(0, 110)));
      }
    });
    // 阅读顺序：检查相邻块是否大致自上而下（允许换栏跳变）
    let jumps = 0;
    for (let i = 1; i < segs.length; i++) {
      if (segs[i].col === segs[i - 1].col && segs[i].yTop < segs[i - 1].yTop - 1) jumps++;
    }
    console.log('  栏内逆序次数(应为0):', jumps);
  }
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
