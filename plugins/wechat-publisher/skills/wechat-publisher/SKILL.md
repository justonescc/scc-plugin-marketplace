---
name: wechat-publisher
description: 微信公众号自动写稿与发布。当用户要写公众号文章、发公众号、给公众号排版、把文章写进公众号草稿箱时使用。流程：按账号定位写稿 → 违禁词自检 → Markdown 转公众号 HTML → Playwright 自动写入公众号后台草稿箱（群发永远由用户人工点击，脚本绝不自动群发）。
---

# 公众号自动写稿发布

代码目录（插件安装处，下称 `$SKILL`，勿手改，升级会被覆盖）。
状态目录：`~/.wechat-publisher/`（下称 `$WP_DATA`）——账号定位、登录态、草稿、截图都存这里，**插件升级不丢**。

## 0. 前置检查

1. 读 `$WP_DATA/config/profile.yaml`。若文件不存在，先拷模板再填：`cp "$SKILL/config/profile.yaml.example" "$WP_DATA/config/profile.yaml"`。若 `name`/`position`/`audience`/`style` 任一还是 `TODO`，**先问用户这几个问题再继续**（一次性问全，不要挤牙膏）。
2. 确认本次选题：用户已给主题就用用户的；没给则按定位推荐 3 个选题让用户挑。

## 1. 写稿

- 字数 800~1500；结构：**开头钩子（3 句内抓住人）→ 小标题分段 → 结尾引导在看/关注**。
- 标题 ≤30 字，输出 3 个候选让用户挑（用户指定了就只用指定的）。
- 摘要 ≤120 字。
- 风格对齐 `profile.yaml` 的 style 与 samples（有范文就读范文提炼风格特征）。
- 产出 Markdown 存 `$WP_DATA/drafts/YYYY-MM-DD-<slug>.md`，文件头带 frontmatter：

```markdown
---
title: 选定的标题
digest: 摘要
author: profile 里的笔名（没有就空）
slug: 短英文标识
---
正文（Markdown）……
```

- **违禁词自检**：正文写完后，逐词比对 `$SKILL/config/banned_words.txt`，命中一律改写为合规表述（不机械删除，改写意思不变）。
- 写稿阶段不问无关问题、不解释流程，写完直接进入排版。

## 2. 排版（Markdown → 公众号 HTML）

```bash
node "$SKILL/scripts/md2wx.mjs" "$WP_DATA/drafts/xxx.md"
```

生成同名 `.html`（公众号内联样式版）。然后兜底复制进剪贴板：

```bash
pbcopy < "$WP_DATA/drafts/xxx.html"
```

## 3. 发布（写入公众号后台草稿箱）

```bash
node "$SKILL/scripts/publish.mjs" "$WP_DATA/drafts/xxx.html" --title "标题" --digest "摘要" [--author "笔名"] [--cover /path/to/封面图]
```

行为与注意：

- 默认**弹出可见浏览器窗口**（不要加 --headless，用户需要看过程、必要时扫码）。
- 首次运行会停在登录页等用户扫码；登录态存 `$WP_DATA/config/mp-storage.json`，之后无需重复扫码。
- 脚本若卡在找「新建图文」入口，会在终端提示用户在浏览器窗口里手动点「新的创作 → 写新图文」，点开后脚本自动继续。
- 成功保存草稿后输出截图路径。**到此为止**：提醒用户到手机/后台预览，确认无误后**人工点群发**，并勾选「内容由 AI 生成」声明。
- **任何情况下不代替用户点「群发」按钮**。
- 脚本失败（公众号改版等）：改用 playwright MCP 工具交互式完成同样步骤（登录 → 新建图文 → 填标题/正文 → 保存草稿），并顺手修 `publish.mjs` 里失效的选择器（修完把改动沉淀回插件仓库）。

## 4. 封面（可选）

- 用户给了 `--cover` 就直接传；没给则提醒用户在保存弹窗里手动选封面，或让用户提供图片路径。
- 封面尺寸：大图 2.35:1（900×383），小图 1:1。

## 5. 数据回采（人工）

- 发布次日，问用户要不要记录数据（阅读/在看/分享/涨粉），手动追加到 `$WP_DATA/drafts/metrics.md`，用于迭代选题和风格。
