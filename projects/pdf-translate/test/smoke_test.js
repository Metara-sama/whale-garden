/* 冒烟测试：jsdom 加载页面 + 全部自写脚本，检查 DOM 绑定与初始化是否出错
 * 用法：NODE_PATH=/tmp/ptest/node_modules node smoke_test.js
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const dir = '/sdcard/Download/Operit/paper_translate';

let html = fs.readFileSync(dir + '/index.html', 'utf8');
// 去掉第三方库脚本（jsdom 里没有 canvas/worker），只测自写代码
html = html.replace(/<script src="lib\/[^"]+"><\/script>/g, '');
['js/pdfparse.js', 'js/translate.js', 'js/render.js', 'js/app.js'].forEach(f => {
  const code = fs.readFileSync(dir + '/' + f, 'utf8').replace(/<\/script>/g, '<\\/script>');
  html = html.replace(`<script src="${f}"></script>`, '<script>' + code + '</script>');
});

const errs = [];
const vc = new (require('jsdom').VirtualConsole)();
vc.on('jsdomError', e => errs.push('jsdomError: ' + (e.detail && e.detail.message || e.message)));
vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://127.0.0.1:8080/',
  virtualConsole: vc
});
const w = dom.window, d = w.document;
let errs2 = [];

(async () => {
  await new Promise(r => setTimeout(r, 120)); // 等 DOMContentLoaded 跑完 init()

  const IDS = ['base', 'key', 'model', 'temp', 'conc', 'batchChars', 'domain', 'file', 'pages', 'scale', 'mode',
    'fontScale', 'optSmartBg', 'optSkipFormula', 'optKeepNumbers', 'optGrow', 'optAutoFill',
    'btnTest', 'btnAnalyze', 'btnTranslate', 'btnRender', 'btnExport', 'btnRunAll', 'btnClear',
    'progFill', 'progText', 'logBox', 'pagesBox', 'viewer', 'viewerImg', 'viewerClose', 'apiStatus'];
  const missing = IDS.filter(id => !d.getElementById(id));
  console.log('缺失的 DOM id:', missing.length ? missing.join(',') : '无');
  console.log('模块导出: PDFParse=' + typeof w.PDFParse + ' Translator=' + typeof w.Translator + ' PaperRender=' + typeof w.PaperRender);

  try {
    d.getElementById('btnClear').click();
    console.log('btnClear 后日志:', d.getElementById('logBox').textContent.trim().slice(0, 40));
    d.getElementById('optKeepNumbers').checked = true;
    d.getElementById('optKeepNumbers').dispatchEvent(new w.Event('change', { bubbles: true }));
    const raw = w.localStorage.getItem('pt_cfg');
    console.log('配置已写入 localStorage:', !!raw);
    if (raw) console.log('  保存字段数:', Object.keys(JSON.parse(raw)).length);
  } catch (e) {
    errs2.push('交互异常: ' + e.message);
  }

  try {
    const p = w.PDFParse.shouldSkip('12.5 ± 0.3', 8, { skipFormula: true });
    const p2 = w.PDFParse.shouldSkip('This is a normal sentence about catalysts.', 8, { skipFormula: true });
    console.log('shouldSkip 公式行 →', JSON.stringify(p), '| 正文行 →', JSON.stringify(p2));
  } catch (e) { errs2.push('shouldSkip 异常: ' + e.message); }

  console.log('结果区初始渲染:', d.getElementById('pagesBox').innerHTML.includes('还没有内容') ? 'OK' : '异常');

  const all = errs.concat(errs2);
  if (all.length) { console.log('\n❌ 发现错误:'); all.forEach(e => console.log('  ' + e)); process.exit(1); }
  console.log('\n✅ 冒烟测试通过');
  process.exit(0);
})();