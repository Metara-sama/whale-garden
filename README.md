# Whale's Garden 🐋

一个纯静态的个人项目花园网页，蓝白海洋气泡主题，零依赖、零框架、零构建。
丢到任何免费托管上就能跑。

## 文件说明

| 文件 | 作用 |
|---|---|
| `index.html` | 页面骨架（顶栏 + hero + 项目区 + 关于） |
| `style.css` | 主题样式，换配色只改开头 `:root` 那组变量 |
| `projects.js` | **只改这个文件就能更新内容**（站点名/简介/项目列表） |
| `app.js` | 渲染逻辑，不用动 |
| `fonts.css` | 字体声明，由 `tools/mkfont.py` 生成，别手改 |
| `assets/` | 吉祥物立绘 + 站点图标（`mascot.webp` / `mascot.png` / `favicon.png`） |
| `assets/fonts/` | 自托管 woff2 字体切片（33 片中文 + 1 片英文） |
| `tools/mkfont.py` | 字体切片工具，网页加了新字就重跑一次 |

### 关于字体

中英文气泡字体都是**自托管**的，不依赖任何 CDN：

- **中文**：站酷快乐体（ZCOOL KuaiLe，免费商用），按 `unicode-range` 切成 33 片，
  收录 GB2312 符号区 + 一级汉字 + 网页实际用字。浏览器只下载页面上真正用到的切片，
  首页通常只吃几十 KB。
- **英文**：Fredoka 700（圆胖气泡感），拉丁子集，只有一个文件。

改完文字如果出现「方框字」，跑一次这个就好：

```bash
cd /sdcard/Download/Operit/whale-garden && python3 tools/mkfont.py
```

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

---

## 已部署状态（本机备忘）

- 站点：https://Metara-sama.github.io/whale-garden/
- 仓库：https://github.com/Metara-sama/whale-garden （Public）

### 本机快捷命令

```bash
/root/preview     # 本地预览，浏览器打开 http://127.0.0.1:18800
/root/wg status   # 项目仓库的 git（仓库在 /root/whale-garden.git，工作树在 sdcard）
```

### 更新内容的两种方式

1. **网页改**（最省事）：GitHub 上打开 `projects.js` → 铅笔图标 → Commit changes，Pages 自动重建
2. **命令行**：

   ```bash
   /root/wg add -A && /root/wg commit -m "更新" && /root/wg push
   ```

   推送认证走 SSH 密钥（`/root/.ssh/id_ed25519`），需先把公钥加到
   https://github.com/settings/ssh/new 。若改用 HTTPS + token，
   执行 `python3 tools/deploy.py <token>` 也可以一条龙搞定。

### 注意事项

- **GitHub Pages 的 CDN 缓存约 10 分钟**，更新后可能要等一会儿才看到；
  它**不区分 URL 查询参数**（`?v=2` 绕不过缓存），耐心等一下或强制刷新即可。
- `projects/` 里是 `/sdcard/Download/项目总集/` 的副本，中文文件名换成了 URL 友好的英文名；原始工程未改动。
- proot 环境若被重置，`/root/whale-garden.git` 和 SSH 密钥会丢失：
  重新生成密钥、把公钥加到 GitHub、再 `git clone` 一次就能恢复，线上站点不受影响。
