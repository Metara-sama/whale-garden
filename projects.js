/* ============================================================
   Whale's Garden —— 只改这个文件就能更新网站内容
   改完直接 push，网页自动刷新。
   ============================================================ */

const SITE = {
  name: "Whale's Garden",
  tagline: "把想法养成一片海。",
  // 关于我：一两句就够
  about: "这里是某某的项目花园。放着一些还在做的事：人工智能、脑科学，以及各种半成品。慢慢养，不着急。",
  // 顶部按钮，想删就删掉整行
  links: [
    { label: "GitHub", url: "https://github.com/yourname" },
    { label: "邮箱", url: "mailto:you@example.com" },
  ],
  footer: "© 2025 Whale's Garden · 用海浪和手写 HTML 搭建"
};

/* 每个项目：name 名称 / desc 一句话介绍 / tags 标签
   status: "live" 已完成上线 / "wip" 进行中 / "" 普通
   links: 一个或多个链接（GitHub、在线预览、文章……）         */

const PROJECTS = [
  {
    name: "项目一：示例占位",
    desc: "一句话说清楚它是什么、解决什么问题。别看描述短，别人点不点进来看全靠这一句。",
    tags: ["Python", "AI"],
    status: "wip",
    year: "2025",
    links: [
      { label: "源码", url: "https://github.com/yourname/repo" }
    ]
  },
  {
    name: "项目二：示例占位",
    desc: "另一个小东西。可以是脚本、笔记库、小工具、实验记录，什么都能放。",
    tags: ["工具", "自动化"],
    status: "live",
    year: "2025",
    links: [
      { label: "在线预览", url: "https://example.com" },
      { label: "源码", url: "https://github.com/yourname/repo2" }
    ]
  }
];
