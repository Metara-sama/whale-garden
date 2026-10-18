/* DOM 冒烟测试：不下浏览器，用 jsdom 跑一遍真实交互路径
   运行：node test/dom_test.js  （需要 /tmp/jsd/node_modules 里的 jsdom） */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('/tmp/jsd/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '');

const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/projects/pdf-kit/',
  virtualConsole: vc
});
const win = dom.window;
const doc = win.document;

let fails = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  ✓ ' + label);
  else { fails++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function q(s) { return doc.querySelector(s); }
function qq(s) { return Array.from(doc.querySelectorAll(s)); }

// ---- 环境打桩 ----
win.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; }
  observe() { }
  unobserve() { }
  disconnect() { }
};
win.HTMLCanvasElement.prototype.getContext = function () {
  return { measureText: () => ({ width: 10 }), fillRect() { }, clearRect() { }, drawImage() { }, setTransform() { } };
};
win.URL.createObjectURL = () => 'blob:fake';
win.URL.revokeObjectURL = () => { };

// pdf.js 打桩：页数写在数据第 0 字节
win.pdfjsLib = {
  GlobalWorkerOptions: {},
  getDocument(opts) {
    const n = opts.data[0] || 1;
    return {
      promise: Promise.resolve({
        numPages: n,
        getPage() {
          return Promise.resolve({
            rotate: 0,
            getViewport(o) { return { width: 100 * o.scale, height: 140 * o.scale }; },
            render() { return { promise: Promise.resolve() }; }
          });
        }
      })
    };
  }
};
const PL = require(path.join(ROOT, 'lib/pdf-lib.min.js'));
win.PDFLib = PL;

// 注入脚本
win.eval(fs.readFileSync(path.join(ROOT, 'js/zip.js'), 'utf8'));
win.eval(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'));

function makeFile(name, pages, byteLen) {
  const data = new Uint8Array(byteLen || (2048 * pages));
  data[0] = pages;
  const f = new win.File([data], name, { type: 'application/pdf' });
  if (!f.arrayBuffer) {
    f.arrayBuffer = () => Promise.resolve(data.buffer.slice(0));
  }
  return f;
}
function loadFiles(files) {
  const input = q('#file-input');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
}
function click(el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })); }

(async () => {
  await sleep(60);

  console.log('\n[1] 初始状态');
  ok(q('#badge-pages').textContent === '0 页', '徽章显示 0 页');
  ok(!q('#empty').hidden, '空态可见');
  ok(q('#toolbar').hidden, '工具栏隐藏');
  ok(q('#btn-export-all').disabled, '导出按钮禁用');
  ok(q('#status').textContent === '就绪', '状态栏就绪', q('#status').textContent);

  console.log('\n[2] 载入两个文件（4 页 + 3 页）');
  loadFiles([makeFile('甲.pdf', 4), makeFile('乙.pdf', 3)]);
  await sleep(200);
  ok(qq('.pg').length === 7, '工位 7 张页卡', String(qq('.pg').length));
  ok(qq('.file').length === 2, '文件列表 2 条');
  ok(q('#badge-pages').textContent === '7 页', '徽章 7 页', q('#badge-pages').textContent);
  ok(!q('#empty').hidden === false, '空态已隐藏');
  ok(q('#pages').textContent.indexOf('p.1') > -1, '页卡带原始页码');
  ok(qq('.pg .pg-no')[0].textContent === '1' && qq('.pg .pg-no')[6].textContent === '7', '工位编号 1…7');

  console.log('\n[3] 点选与统计');
  click(qq('.pg')[2]);
  await sleep(30);
  ok(qq('.pg')[2].classList.contains('sel'), '第 3 页选中');
  ok(q('#badge-sel').textContent === '选中 1', '选中计数 1', q('#badge-sel').textContent);
  ok(!q('#btn-export-sel').disabled, '只导出选中可用');

  console.log('\n[4] 工具栏批量选择');
  click(qq('#toolbar button[data-act="all"]')[0]);
  ok(q('#badge-sel').textContent === '选中 7', '全选 7', q('#badge-sel').textContent);
  click(qq('#toolbar button[data-act="odd"]')[0]);
  ok(q('#badge-sel').textContent === '选中 4', '奇数页 4 张', q('#badge-sel').textContent);
  click(qq('#toolbar button[data-act="even"]')[0]);
  ok(q('#badge-sel').textContent === '选中 3', '偶数页 3 张', q('#badge-sel').textContent);
  click(qq('#toolbar button[data-act="invert"]')[0]);
  ok(q('#badge-sel').textContent === '选中 4', '反选 4 张', q('#badge-sel').textContent);
  click(qq('#toolbar button[data-act="none"]')[0]);
  ok(q('#badge-sel').textContent === '选中 0', '清空选择');

  console.log('\n[5] 按编号选择');
  q('#sel-expr').value = '1-2,7';
  click(q('#btn-sel-apply'));
  await sleep(20);
  ok(q('#badge-sel').textContent === '选中 3', '1-2,7 → 3 张', q('#badge-sel').textContent);
  q('#sel-expr').value = '99';
  click(q('#btn-sel-apply'));
  ok(q('#toast').className.indexOf('err') > -1, '超范围时报错 toast', q('#toast').textContent);

  console.log('\n[6] 旋转');
  q('#sel-expr').value = '1';
  click(q('#btn-sel-apply'));
  click(qq('#toolbar button[data-act="rotate"]')[0]);
  await sleep(30);
  ok(qq('.pg')[0].querySelector('.pg-size').textContent.indexOf('90') > -1, '第 1 页标记 90°',
    qq('.pg')[0].querySelector('.pg-size').textContent);
  click(qq('#toolbar button[data-act="rotate"]')[0]);
  click(qq('#toolbar button[data-act="rotate"]')[0]);
  click(qq('#toolbar button[data-act="rotate"]')[0]);
  ok(qq('.pg')[0].querySelector('.pg-size').textContent === '', '转满 360° 复位');

  console.log('\n[7] 删除页 + 恢复');
  q('#sel-expr').value = '1-2';
  click(q('#btn-sel-apply'));
  click(qq('#toolbar button[data-act="remove"]')[0]);
  await sleep(30);
  ok(qq('.pg').length === 5, '删掉 2 页后剩 5 张', String(qq('.pg').length));
  ok(qq('.file')[0].querySelector('[data-act="restore-file"]') !== null, '出现 ↺ 恢复按钮');
  ok(qq('.file')[0].textContent.indexOf('2 / 4 页') > -1, '文件行显示 2 / 4 页', qq('.file')[0].textContent);
  click(qq('.file')[0].querySelector('[data-act="restore-file"]'));
  await sleep(60);
  ok(qq('.pg').length === 7, '恢复后 7 张', String(qq('.pg').length));
  ok(qq('.file')[0].querySelector('[data-act="restore-file"]') === null, '恢复后 ↺ 消失');

  console.log('\n[8] 反转顺序');
  const firstBefore = qq('.pg')[0].querySelector('.pg-of').textContent;
  click(qq('#toolbar button[data-act="reverse"]')[0]);
  await sleep(30);
  const firstAfter = qq('.pg')[0].querySelector('.pg-of').textContent;
  ok(firstBefore !== firstAfter, '首张换人', firstBefore + ' → ' + firstAfter);
  ok(q('#badge-pages').textContent === '7 页', '页数不变');
  click(qq('#toolbar button[data-act="reverse"]')[0]);

  console.log('\n[9] 拆分模式切换');
  ok(!q('[data-mode-field="range"]').hidden, '默认显示范围输入');
  click(qq('#split-mode button[data-mode="every"]')[0]);
  ok(q('[data-mode-field="range"]').hidden && !q('[data-mode-field="every"]').hidden, '切到每 N 页');
  click(qq('#split-mode button[data-mode="single"]')[0]);
  ok(q('[data-mode-field="every"]').hidden, '每页一份没有额外输入');

  console.log('\n[10] 导出错误路径（假 PDF 数据应当被捕获而不是炸掉）');
  click(q('#btn-export-all'));
  await sleep(300);
  const st = q('#status').textContent;
  ok(st.indexOf('出错') > -1 || st.indexOf('已导出') > -1, '状态栏有结果反馈', st);
  ok(!q('#btn-export-all').disabled, '结束后按钮恢复可用');
  ok(q('#btn-cancel').hidden, '取消按钮收起');

  console.log('\n[11] 清空全部');
  click(qq('.file')[0].querySelector('[data-act="rm-file"]'));
  await sleep(20);
  click(qq('.file')[0].querySelector('[data-act="rm-file"]'));
  await sleep(20);
  ok(qq('.pg').length === 0, '页卡清空');
  ok(!q('#empty').hidden, '回到空态');
  ok(q('#toolbar').hidden, '工具栏隐藏');

  if (errors.length) {
    console.log('\n控制台异常：');
    errors.slice(0, 8).forEach((e) => console.log('  ! ' + e));
  }
  console.log('\n' + (fails ? '❌ 失败 ' + fails + ' 项' : '✅ 全部通过') + (errors.length ? '（有 ' + errors.length + ' 条控制台异常）' : ''));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('测试崩溃', e); process.exit(1); });