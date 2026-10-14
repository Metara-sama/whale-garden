#!/usr/bin/env python3
"""一键把 Whale's Garden 部署到 GitHub Pages

用法（只需要一个 token，用户名会从 token 自动识别）：

    python3 tools/deploy.py <token> [仓库名]

脚本会依次做四件事，每一步都会打印结果：
    1. 用 token 调 /user 验证有效性，拿到你的用户名
    2. 仓库不存在就用 /user/repos 创建一个公开仓库（已存在则跳过）
    3. push 本地 main 分支（token 只用于本次推送，不写进 git 配置）
    4. 用 /repos/{owner}/{repo}/pages 打开 GitHub Pages（branch: main, path: /）

只申请一个 token 权限就够：classic token 勾 `repo`。
跑完建议立刻到 GitHub 把它删掉。
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

API = "https://api.github.com"
GITDIR = "/root/whale-garden.git"
WORKTREE = "/sdcard/Download/Operit/whale-garden"
DEFAULT_REPO = "whale-garden"


def api(method, path, token, body=None):
    req = urllib.request.Request(
        API + path,
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "User-Agent": "whale-garden-deploy",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            payload = json.loads(raw) if raw.strip() else {}
        except ValueError:
            payload = {"message": raw[:200]}
        return e.code, payload


def git(*args):
    env = dict(os.environ)
    env["GIT_WORK_TREE"] = WORKTREE
    env["GIT_TERMINAL_PROMPT"] = "0"
    return subprocess.run(["git"] + list(args), cwd=GITDIR, env=env,
                          capture_output=True, text=True)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    token = sys.argv[1].strip()
    repo = sys.argv[2].strip() if len(sys.argv) > 2 else DEFAULT_REPO

    print("[1/4] 校验 token ...")
    status, me = api("GET", "/user", token)
    if status != 200:
        print("  token 无效或权限不足：", status, me.get("message"))
        return 2
    login = me["login"]
    print("  已登录为：", login)

    print("[2/4] 检查 / 创建仓库 %s ..." % repo)
    status, info = api("GET", "/repos/%s/%s" % (login, repo), token)
    if status == 200:
        print("  仓库已存在，跳过创建：", info.get("html_url"))
    else:
        status, info = api("POST", "/user/repos", token, {
            "name": repo,
            "private": False,
            "auto_init": False,
            "description": "Whale's Garden - 个人项目花园",
            "has_wiki": False,
            "has_projects": False,
        })
        if status not in (200, 201):
            print("  创建失败：", status, info.get("message"))
            return 3
        print("  已创建：", info.get("html_url"))

    print("[3/4] 推送到远端 ...")
    git("remote", "remove", "origin")          # 不存在时报错，忽略即可
    git("remote", "add", "origin", "https://github.com/%s/%s.git" % (login, repo))
    helper = "!f() { echo username=%s; echo password=%s; }; f" % (login, token)
    result = git("-c", "credential.helper=" + helper, "push", "-u", "origin", "main")
    if result.returncode != 0:
        err = (result.stderr or "").strip().splitlines()
        print("  直接推送失败：", err[-1] if err else "unknown")
        print("  尝试合并远端已有提交后重试 ...")
        git("pull", "--rebase", "--allow-unrelated-histories",
            "https://%s:%s@github.com/%s/%s.git" % (login, token, login, repo), "main")
        result = git("-c", "credential.helper=" + helper, "push", "-u", "origin", "main")
        if result.returncode != 0:
            err = (result.stderr or "").strip().splitlines()
            print("  仍然失败：", err[-1] if err else "unknown")
            return 4
    print("  推送完成：", (result.stdout or "").strip().splitlines()[-1] if result.stdout else "ok")

    print("[4/4] 开启 GitHub Pages ...")
    status, info = api("POST", "/repos/%s/%s/pages" % (login, repo), token,
                       {"source": {"branch": "main", "path": "/"}})
    if status in (200, 201):
        print("  已开启")
    elif status == 409:
        print("  之前已开启，无需重复")
    else:
        print("  开启失败：", status, info.get("message"))
        print("  可稍后手动到仓库 Settings → Pages 里选择 main / (root)")

    print("\n站点地址（首次部署需等 1~2 分钟构建）：")
    print("  https://%s.github.io/%s/" % (login, repo))
    return 0


sys.exit(main())