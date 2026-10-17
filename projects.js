/* ============================================================
   Whale's Garden —— 只改这个文件就能更新网站内容
   改完直接 push，网页自动刷新。
   （标签功能已移除；想恢复的话，给每项加 tags 数组、
     再在 app.js 里把渲染和筛选逻辑加回来即可）
   ============================================================ */

const SITE = {
  name: "Whale's Garden",
  tagline: "把想法养成一片海。",
  // 关于我：一两句就够
  about: "这里是 Metara-sama 的项目花园。放着一些还在做的事：人工智能、脑科学、化学，以及各种半成品。慢慢养，不着急。",
  // 右上角按钮，想删就删掉整行
  links: [
    { label: "GitHub", url: "https://github.com/Metara-sama" }
  ],
  footer: "© 2025 Whale's Garden · 用海浪和手写 HTML 搭建"
};

/* 每个项目：name 名称 / desc 一句话介绍
   status: "live" 已完成上线 / "wip" 进行中 / "" 普通
   links: 一个或多个链接（在线玩、源码、文章……）            */

const PROJECTS = [
  {
    name: "谁在冲浪 · Live2D 冲浪测试器",
    desc: "下面那个模型横躺着当冲浪板，上面那个踩着它冲浪 —— 两个模型都能换，25 个角色随你挑。自带 10 个整体动画（腾空 / 海豚跳 / 钻浪管 / 加速冲刺…）、会跟着鼓点起伏的海浪，也能传自己的 BGM。",
    status: "live",
    year: "2025",
    links: [
      { label: "开始冲浪", url: "projects/live2d-surf/" }
    ]
  },
  {
    name: "Millsage 剧情演示",
    desc: "带语音的剧情演示页：立绘 + 对白逐句推进。有声版和静音版各一个入口，素材全部内嵌在单文件里，点开就能看。",
    status: "live",
    year: "2025",
    links: [
      { label: "有声版", url: "projects/millsage/" },
      { label: "静音版", url: "projects/millsage/silent.html" }
    ]
  },
  {
    name: "离子鉴定大冒险",
    desc: "化学盲测小游戏：随机抽 2~18 个未知阳离子摆进表头，你用阴离子试剂逐个试探、看现象自己推断，最后提交判分。7 种阴离子试剂之外还有过量 NaOH、浓氨水、过量浓氨水三组（专治两性溶解与氨络合），可开「无色模式」只抽无色离子，也可开「纯文字模式」不看图、只读现象描述。",
    status: "live",
    year: "2025",
    links: [
      { label: "开始游戏", url: "projects/ion-id/" }
    ]
  },
  {
    name: "金属离子反应现象图鉴",
    desc: "18 种金属离子 × 7 种常见试剂的实拍现象汇总，每格配反应方程式，会生成沉淀的都标了 Ksp。",
    status: "live",
    year: "2025",
    links: [
      { label: "打开图鉴", url: "projects/ion-id/phenomena.html" }
    ]
  },
  {
    name: "有机化学幸存者",
    desc: "把有机化学的知识点塞进生存类玩法的单文件小游戏，边玩边把反应规律记进脑子。",
    status: "live",
    year: "2025",
    links: [
      { label: "开始游戏", url: "projects/organic-chem-survivor.html" }
    ]
  },
  {
    name: "PDF 自动翻译与嵌字",
    desc: "丢一整本 PDF 进去：自动抽取文本、逐段翻译，再把译文按原版式嵌回页面，最后导出成新的 PDF。在浏览器里跑，需要自备 DeepSeek API Key。",
    status: "live",
    year: "2025",
    links: [
      { label: "打开工具", url: "projects/pdf-translate/" }
    ]
  }
];
