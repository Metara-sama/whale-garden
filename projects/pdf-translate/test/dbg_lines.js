/* 行结构诊断：node dbg_lines.js <pdf> <页号> */
const fs = require('fs');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
global.window = global;
new Function('window', fs.readFileSync('/sdcard/Download/Operit/paper_translate/js/pdfparse.js', 'utf8'))(global);
global.pdfjsLib = pdfjs;

(async () => {
  const pdfPath = process.argv[2];
  const pn = Number(process.argv[3] || 2);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)) }).promise;
  const p = await PDFParse.analyzePage(doc, pn, { skipFormula: true, debug: true });
  const L = p._lines;
  console.log('页面宽', p.w.toFixed(1), '行数', L.length, 'dbg', JSON.stringify(p._dbg));
  const cross = L.filter(l => l.x0 < p.w * 0.48 && l.x1 > p.w * 0.52);
  console.log('跨中心行数:', cross.length);
  cross.slice(0, 10).forEach(l => console.log(`  [${l.x0}→${l.x1}] n=${l.n} ${l.t}`));
  // 看一个跨中心行的 item 切分
  console.log('\n样本行内容长度分布:');
  const w = L.map(l => l.x1 - l.x0).sort((a, b) => a - b);
  console.log('  宽度 min/med/max =', w[0], w[Math.floor(w.length / 2)], w[w.length - 1]);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });