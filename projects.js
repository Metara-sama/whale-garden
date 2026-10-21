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
    name: "同人文猎手",
    desc: "贴吧和 NGA 的同人文，搜得到，也存得下来。",
    status: "live",
    year: "2026",
    links: [
      { label: "打开工具", url: "projects/fanfic-hunter/" }
    ]
  },
  {
    name: "PDF 拆分合并",
    desc: "拖进 PDF，拆开、拼起来、转个角度，全在本机完成。",
    status: "live",
    year: "2026",
    links: [
      { label: "打开工具", url: "projects/pdf-kit/" }
    ]
  },
  {
    name: "阵亡通报生成器",
    desc: "传张头像填个名字，就出一份真站点排版的「阵亡通报」。",
    status: "live",
    year: "2026",
    links: [
      { label: "打开生成器", url: "projects/wt-obituary/" }
    ]
  },
  {
    name: "阈限 · Liminal",
    desc: "摇杆推着走：泳池、后室、黄昏草甸，整个作品不到 90KB。",
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
    desc: "东方五代原作 STG 移植（转载 GPL-3.0），进去就能跑。",
    status: "live",
    category: "port",
    year: "2026",
    links: [
      { label: "进去玩", url: "projects/touhou/" }
    ]
  },
  {
    name: "闹麻编辑器",
    desc: "贴段文字，自动给能对上表情的词挂上 emoji。",
    status: "live",
    year: "2026",
    links: [
      { label: "开始编辑", url: "projects/naomao/" }
    ]
  },
  {
    name: "音MAD · Vapor Sample",
    desc: "把 MIDI 每条音轨换成你上传的采样，再导成 WAV。",
    status: "live",
    year: "2025",
    links: [
      { label: "打开工作台", url: "/vapor-mad/" }
    ]
  },

  {
    name: "谁在冲浪 · Live2D 冲浪测试器",
    desc: "一个躺着当冲浪板，一个踩着它冲 —— 角色和 BGM 都能换。",
    status: "live",
    year: "2025",
    links: [
      { label: "开始冲浪", url: "projects/live2d-surf/" }
    ]
  },
  {
    name: "Millsage 剧情演示",
    desc: "带语音的剧情演示，Live2D 版六套模型随对白切换。",
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
    desc: "抽几个未知阳离子，用试剂试出来 —— 化学盲测游戏。",
    status: "live",
    year: "2025",
    links: [
      { label: "开始游戏", url: "projects/ion-id/" }
    ]
  },
  {
    name: "金属离子反应现象图鉴",
    desc: "18 种离子 × 7 种试剂的实拍现象，配方程式与 Ksp。",
    status: "live",
    year: "2025",
    links: [
      { label: "打开图鉴", url: "projects/ion-id/phenomena.html" }
    ]
  },
  {
    name: "有机化学幸存者",
    desc: "把有机化学塞进生存玩法，边打边把反应规律记住。",
    status: "live",
    year: "2025",
    links: [
      { label: "开始游戏", url: "projects/organic-chem-survivor.html" }
    ]
  },
  {
    name: "PDF 自动翻译与嵌字",
    desc: "整本 PDF 丢进去，自动翻译、按原版式嵌回再导出。",
    status: "live",
    year: "2025",
    links: [
      { label: "打开工具", url: "projects/pdf-translate/" }
    ]
  },
  {
    name: "POCKET",
    desc: "一台能开机的拟物掌机，五张 GBA 卡带，也能塞自己的 ROM。",
    status: "live",
    year: "2026",
    links: [
      { label: "开机", url: "projects/pocket/" }
    ]
  }
];
