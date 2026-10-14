# Whale's Garden 🐋

一个纯静态的个人项目花园网页，深蓝深海主题，零依赖、零框架、零构建。
四个文件丢到任何免费托管上就能跑。

## 文件说明

| 文件 | 作用 |
|---|---|
| `index.html` | 页面骨架，基本不用动 |
| `style.css` | 深蓝主题样式，想换色改开头的 `:root` 变量 |
| `projects.js` | **只改这个文件就能更新内容**（站点名/简介/项目列表） |
| `app.js` | 渲染逻辑，不用动 |
| `assets/` | 吉祥物立绘 + 站点图标（`mascot.webp` / `mascot.png` / `favicon.png`） |

先在手机浏览器里直接打开 `index.html` 就能本地预览。

## 怎么加项目

打开 `projects.js`，照着 `PROJECTS` 数组里已有的格式复制一份：

```js
{
  name: "项目名",
  desc: "一句话说清楚它是什么。",
  tags: ["Python", "AI"],        // 标签会自动变成筛选按钮
  status: "wip",                 // "live" 已完成 / "wip" 进行中 / 留空
  year: "2025",
  links: [
    { label: "源码", url: "https://github.com/..." }
  ]
}
```

保存 → 提交 → 网页自动更新。

---

## 免费托管方案

### 方案 A：GitHub Pages（推荐，最省事）

1. 在 github.com 新建一个 **Public** 仓库，名字叫 `whale-garden`
2. 把这 4 个文件上传到仓库根目录
3. 仓库 → Settings → Pages → Source 选 `Deploy from a branch`，
   Branch 选 `main` + `/ (root)` → Save
4. 等 1 分钟左右，访问：

   ```
   https://你的用户名.github.io/whale-garden/
   ```

用终端推（在项目目录里执行）：

```bash
git init -b main
git add -A
git commit -m "init Whale's Garden"
git remote add origin https://github.com/用户名/whale-garden.git
git push -u origin main
# 提示输入密码时，填 GitHub 的 Personal Access Token（不是登录密码）
```

可选：建一个名为 `用户名.github.io` 的仓库，就能用 `https://用户名.github.io/` 这个根域名。

### 方案 B：Cloudflare Pages（国内访问通常更快）

- Cloudflare 控制台 → Workers & Pages → Create → Pages → 连接 GitHub 仓库
- 构建设置全部留空（Build command 空、Output directory 填 `/`）
- 免费版：无限带宽、全球 CDN、可绑自定义域名 + 免费 HTTPS

### 方案 C：Vercel / Netlify

同样是"连仓库 → 自动部署"，Vercel 的免费域名是 `xxx.vercel.app`。
Netlify 还支持直接把文件夹拖进网页里部署，连 Git 都不用。

---

## 费用

全部 **0 元**。以上都提供免费 HTTPS 和免费子域名，
只有绑自己的域名时才需要单独买域名（约 30–70 元/年），这一步可以不做。
