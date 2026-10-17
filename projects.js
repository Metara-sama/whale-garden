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
   category: 省略或 "own" = 原创；"port" = 转载移植（首页单独一段）
   links: 一个或多个链接（在线玩、源码、文章……）            */
const PROJECTS = [
  {
    name: "阈限 · Liminal",
    desc: "梦核 / 池核风格的第一人称阈限空间：瓷砖泳池、黄色后室、黄昏草甸。没有任务、没有分数、几乎没有文字——按住屏幕往前走，走到光里就换一个场景，停下时世界会凝固、画面自己慢慢显影。画面是手写 raymarching 现算的，材质是 Canvas 现画的，声音是 WebAudio 现场合成的，整个作品不到 100KB，没有一个外部资源文件。",
    status: "live",
    year: "2026",
    links: [
      { label: "走进去", url: "projects/liminal/" }
    ]
  },
  {
    name: "邦友的酒模拟器",
    desc: "所有人保持Q弹！",
    status: "live",
    year: "2026",
    links: [
      { label: "进去弹", url: "projects/q-doll/" }
    ]
  },
  {
    name: "EAGLER TOUHOU · 东方原作 Web 化",
    desc: "东方 Project 原作 STG 的浏览器移植：红魔乡、妖妖梦、永夜抄、风神录、绀珠传，进去就跑。转载自 YomotsuHisami/eagler-touhou（GPL-3.0-or-later）。",
    status: "live",
    category: "port",
    year: "2026",
    links: [
      { label: "进去玩", url: "projects/touhou/" }
    ]
  },
  {
    name: "音MAD · Vapor Sample",
    desc: "把 MIDI 拆成音轨，每条音轨用你自己上传的采样当音色，也能按 GM 音色表默认出声；自带一个简易音频工作台（剪辑、滤波、失真、延迟、混响、变调、倍速），每条音轨能单独改音符、移调、量化，最后导出 WAV。背景是蒸汽波落日，可以一键关掉只留频谱。",
    status: "live",
    year: "2025",
    links: [
      { label: "打开工作台", url: "/vapor-mad/" }
    ]
  },

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
    desc: "带语音的剧情演示页：立绘 + 对白逐句推进。有声版和静音版是素材全内嵌的单文件；Live2D 版则是六套模型（汐见萤 / 伊泽枣 / 琴平凪 / 滨崎茉幌 / 和泉朋花 / 泽海奏多）跟着对白实时切换，动作和表情照搬游戏本体演出脚本。",
    status: "live",
    year: "2025",
    links: [
      { label: "Live2D 版", url: "projects/millsage-live2d/" },
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
