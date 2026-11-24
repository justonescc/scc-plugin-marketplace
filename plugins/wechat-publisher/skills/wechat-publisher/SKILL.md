---
name: wechat-publisher
description: 微信公众号自动写稿与发布。当用户要写公众号文章、发公众号、给公众号排版、把文章写进公众号草稿箱时使用。流程：按账号定位写稿 → 违禁词自检 → Markdown 转公众号 HTML → Playwright 自动写入公众号后台草稿箱（群发永远由用户人工点击，脚本绝不自动群发）。
---

# 公众号自动写稿发布

代码目录（插件安装处，下称 `$SKILL`，勿手改，升级会被覆盖）。
状态目录：`~/.wechat-publisher/`（下称 `$WP_DATA`）——账号定位、草稿、截图都存这里，**插件升级不丢**。

## 0. 前置检查

1. 读 `$WP_DATA/config/profile.yaml`。若文件不存在，先拷模板再填：`cp "$SKILL/config/profile.yaml.example" "$WP_DATA/config/profile.yaml"`。若 `name`/`position`/`audience`/`style` 任一还是 `TODO`，**先问用户这几个问题再继续**（一次性问全，不要挤牙膏）。
2. 确认本次选题：用户已给主题就用用户的；没给则按定位推荐 3 个选题让用户挑。
3. **防撞题**：`ls $WP_DATA/drafts/*.md` 扫一眼最近几篇的主题——已有同题材未发草稿时提醒用户（同领域两篇要么合并、要么错开几天发，避免同质化）。

## 1. 写稿

- **事实核查（硬性）**：正文里的数据、玩法名、版本内容必须 **≥2 个独立来源交叉核实**（官方公告 > 攻略站当日文 > 社区帖）；搜到但无法交叉验证的爆料词**一律不进正文**。踩过的坑：基于未证实爆料写的草稿（如臆测玩法名）会整篇作废重写。
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

- **产出自查（每份产出物落盘后过一遍，历史上反复出现生成损坏）**：
  - HTML/CSS 里有没有坏 token（无效色值如 `#2c3xxx955`、错字闭合标签如 `</文>`、凭空属性）——`grep -nE '#[0-9a-fA-F]*[^0-9a-fA-F#]'` 和目检 `<style>` 段
  - 文件名与实际文件 `ls` 对账（日期笔误如 11-00、年份写错会导致截图/发布读不到文件）
  - 信息卡标题数字与正文一致（如「这三件事」vs 卡上 4 条）
  - 封面卡截图后**验证 PNG 尺寸**（必须 1800×766 即 2.35:1；截图脚本 clip 参数失效时会是整页尺寸）

- **违禁词自检**：正文写完后跑 `node "$SKILL/scripts/check-banned.mjs" <draft.md>`（比对 banned_words.txt + profile.yaml 的 banned_extra，命中输出词与行号，exit 1）。命中一律改写为合规表述（不机械删除，改写意思不变），改完重跑至通过。
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
node "$SKILL/scripts/publish.mjs" "$WP_DATA/drafts/xxx.html" --title "标题" --digest "摘要" [--author "笔名"] [--cover 封面] [--img-top 文首配图] [--img-end 文末配图] [--original 原创作者名] [--ai-source]
# 失败重跑续编（直达上次那份草稿，已设置的部分自动跳过，不会重复插图/叠正文）：
node "$SKILL/scripts/publish.mjs" "$WP_DATA/drafts/xxx.html" --resume "$WP_DATA/drafts/publish-*-url.txt" --title "标题" --digest "摘要" [--original ...] [--ai-source ...]
```

行为与注意：

- 默认**弹出可见浏览器窗口**（不要加 --headless，用户需要扫码）。
- **每次发布都必须扫码登录**：脚本不保存任何登录凭证（登录态不落盘，用完即弃），每次运行都停在登录页等管理员微信扫码（等 180 秒），扫码后需在手机上确认。不要为了「省事」把登录态缓存回来。
- **新参数（v6，2026-11-24 实测交互固化）**：
  - `--original "作者名"`：声明文字原创（作者 ≤8 字）。注意原创作者栏校验只认 keydown/keyup+blur 事件链，`fill` 类 API 不触发——已在脚本内处理。
  - `--ai-source`：创作来源标「内容由AI生成」。radio 选中后必须点弹层内「确认」，Escape 会丢选择——已在脚本内处理。v6.3 修复（2026-11-24 实测）：「创作来源」行旁带 tooltip 问号图标（svg/i 子元素），按叶子元素（`children.length===0`）定位必失败报「没找到创作来源设置行」——脚本已改为「文本以『创作来源』开头」的可见元素中取文本最短者上溯定位。
  - 账号当前的合规基线（用户拍板）：AI 起稿文章走「声明原创 + --ai-source」组合。
- 脚本若卡在找「新建图文」入口，会在终端提示用户在浏览器窗口里手动点「新的创作 → 写新图文」，点开后脚本自动继续。
- 成功保存草稿后输出截图路径。**到此为止**：提醒用户到手机/后台预览，确认无误后**人工点群发**，并勾选「内容由 AI 生成」声明。
- **垃圾自动清理**：发布成功后脚本自动调 cleanup.mjs——旧发布截图与过期 probe 诊断只保留最新 5 个，续编 `-url.txt`、一次性截图脚本、过时软链全删；正式产物（草稿 md/html、cards 卡片）永不碰。手动清理/预览：`node "$SKILL/scripts/cleanup.mjs" [--keep 5] [--dry-run]`。
- **任何情况下不代替用户点「群发」按钮**。
- 脚本失败（公众号改版等）：改用 playwright MCP 工具交互式完成同样步骤（登录 → 新建图文 → 填标题/正文 → 保存草稿），并顺手修 `publish.mjs` 里失效的选择器（修完把改动沉淀回插件仓库）。
- **排障：编辑页报「系统错误(320003)」**= 编辑会话/token 失效。回到 `mp.weixin.qq.com` 首页（会自动恢复登录态），从首页/草稿箱重新进编辑页即可，token 一般不变；不要反复硬刷同一个报错 URL。
- **失败重跑注意**：编辑器会自动保存，失败的那次运行很可能已在草稿箱留了**不完整同名草稿**——优先用 `--resume` 续编那份草稿（URL 已由脚本存成 `-url.txt`，直接传文件路径即可），标题/正文/摘要/封面/原创/AI来源已设置的会自动跳过；若从零重跑，成功后记得去草稿箱删同名旧草稿（v6 实测踩过：同标题草稿攒了两份，封面错的留着没用）。续编时**不要再传 `--img-top/--img-end`**（除非确实是配图缺失，否则会重复插图）。

## 4. 封面与配图（可选）

- 封面：**写稿阶段默认根据标题自动生成封面卡**（HTML 排版 → playwright 截 PNG，900×383 即 2.35:1，存 `$WP_DATA/drafts/cards/`），发布时 `--cover` 传入——publish.mjs v5 已修复自动上传链路（图片库上传 → 选图 → 下一步 → 裁剪确认，全自动），**不需要手动补封面**。用户明确给了图片路径就用用户的；都没有才提醒手动选。小图 1:1 由微信后台默认裁剪生成，可后期手动调。
  - **截图统一用通用脚本，别再复制 shot-xxx.js**：`node "$SKILL/scripts/shot.mjs" <card.html> <out.png> [w=900] [h=383]`（文件名可相对 cards/ 目录；信息卡传实际尺寸如 900 950）。截完 `sips -g pixelWidth -g pixelHeight` 验证尺寸。
  - 真实交互（实测）：封面区 `#js_cover_area`（「拖拽或选择封面」）点击后弹出四选项——**从正文选择 / 从图片库选择 / 微信扫码上传 / 一键生成封面**。脚本走「从图片库选择」（`.js_imagedialog` 有多处同名元素，必须取浮层里 offsetParent 非空的实例）。**没有本地直传封面的入口**，不要再去猜 `上传封面` 按钮。
  - v5 关键坑（2026-11-24 实测修复）：图片库弹层的「上传文件」按钮被 WebUploader 动态 `<label>` 盖住，真实点击会报 `intercepts pointer events` 无限重试——脚本已改为程序化 `input[type=file].click()` 触发 filechooser。上传完成判据是 `.weui-desktop-img-picker__item` 数量增加，选中新图后要点「下一步」再点「确认」。
  - v6.2 关键坑（2026-11-24 实测修复，三个全是当天踩的）：
    1. **选新图不能盲选列表第一项**：图片库有历史图时旧图会排前面（实测封面错选成上一篇的旧卡）；文件名匹配也必失败（item 的 textContent 不含文件名）——脚本已改为**上传前后 img src 差集找新图**，认不出就报失败并导出 probe，绝不盲选。
    2. **file input 必须排除正文插图框**：兜底盲取 `inputs[length-1]` 会命中 `li#js_editor_insertimage` 下的 input，把封面图直接插进正文——脚本已排除 `#js_editor_insertimage` 后代。waitForEvent(filechooser) 必须先注册再触发 click（竞态）。
    3. **正文粘贴误报失败**：粘贴成功判据的 probe 已去空白，但页面渲染文本带空格（「让 AI 帮你写…」），includes/getByText 永远不匹配——比对前对页面文本做同样空白归一化。
  - 成功判据：封面区出现预览图（`#js_cover_area img` / `.js_cover_preview_new img`）或出现「修改/换一张」文案，**且预览 src 与刚上传图的 src 前缀一致**（不一致脚本会告警「可能选了旧图」）。没看到就报失败并导出 `probe-cover-*.json`，不要误报成功。
- 正文配图：需要信息卡类配图时，Claude 用 HTML 排版出卡（贴合选题的风格，存 `$WP_DATA/drafts/cards/`）→ playwright 以 deviceScaleFactor 2 截 PNG → 发布时 `--img-top`（文首）/ `--img-end`（文末）传入。
  - 插图两种方案：工具栏「图片」按钮 + filechooser；失败则剪贴板写入 PNG 后 Cmd+V 粘贴（ProseMirror 支持）。**成功判据是编辑区 `.ProseMirror img` 数量增加**，没增加就提示手动插入。
- 注意：真实游戏截图在开服前拿不到，可先发信息卡版，开服后再补截图版。

## 5. 数据回采（人工）

- 发布次日，问用户要不要记录数据（阅读/在看/分享/涨粉），手动追加到 `$WP_DATA/drafts/metrics.md`，用于迭代选题和风格。
