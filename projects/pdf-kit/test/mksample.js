/* 生成测试样例 PDF：test/sample-12p.pdf（竖版 12 页）+ test/sample-3p.pdf（横版 3 页） */
const fs = require('fs');
const path = require('path');
const PL = require(path.join(__dirname, '../lib/pdf-lib.min.js'));
const { PDFDocument, StandardFonts, rgb } = PL;

const COL = [
  [.12, .42, .72], [.85, .35, .35], [.18, .62, .45],
  [.72, .50, .16], [.40, .35, .72], [.10, .55, .62]
];

(async () => {
  const jobs = [['sample-12p.pdf', 12, false], ['sample-3p.pdf', 3, true]];
  for (const job of jobs) {
    const name = job[0], n = job[1], landscape = job[2];
    const doc = await PDFDocument.create();
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const reg = await doc.embedFont(StandardFonts.Helvetica);
    const W = landscape ? 595 : 420, H = landscape ? 420 : 595;

    for (let i = 1; i <= n; i++) {
      const p = doc.addPage([W, H]);
      const c = COL[(i - 1) % COL.length];
      p.drawRectangle({ x: 0, y: H - 92, width: W, height: 92, color: rgb(c[0], c[1], c[2]) });
      p.drawText('Whale PDF Kit', { x: 34, y: H - 64, size: 26, font: bold, color: rgb(1, 1, 1) });
      p.drawText('Page ' + i + ' / ' + n, { x: 34, y: H - 118, size: 34, font: bold, color: rgb(.1, .15, .2) });
      p.drawText('sample document for split & merge test', { x: 34, y: H - 150, size: 12, font: reg, color: rgb(.35, .4, .45) });
      for (let k = 0; k < 14; k++) {
        p.drawText('line ' + String(k + 1).padStart(2, '0') + ' - lorem ipsum dolor sit amet consectetur',
          { x: 34, y: H - 190 - k * 18, size: 9, font: reg, color: rgb(.55, .6, .65) });
      }
      p.drawText(String(i), { x: W / 2 - 8, y: 26, size: 12, font: bold, color: rgb(.45, .5, .55) });
    }
    const bytes = await doc.save();
    fs.writeFileSync(path.join(__dirname, name), bytes);
    console.log(name, bytes.length, 'bytes', n, 'pages', landscape ? 'landscape' : 'portrait');
  }
})();