---
name: wechat-publisher
description: 微信公众号自动写稿与发布。当用户要写公众号文章、发公众号、给公众号排版、把文章写进公众号草稿箱时使用。流程：按账号定位写稿 → 违禁词自检 → Markdown 转公众号 HTML → Playwright 自动写入公众号后台草稿箱（群发永远由用户人工点击，脚本绝不自动群发）。
---

# 公众号自动写稿发布

代码目录（插件安装处，下称 `$SKILL`，勿手改，升级会被覆盖）。
状态目录：`~/.wechat-publisher/`（下称 `$WP_DATA`）——账号定位、草稿、截图都存这里，**插件升级不丢**。
依赖：脚本要 `$SKILL/node_modules`（playwright@1.60.0 锁死本地 chromium-1223 缓存，**勿升 playwright 版本**——新版会要求下载 chromium-1255）。插件升级出新目录后依赖不会自动带过来：从旧版本目录拷 `node_modules` + `package-lock.json`（lock 已入库），或在 `$SKILL` 下 `npm ci`，缺依赖报 `Cannot find package 'playwright'` 即此因。

## 0. 前置检查

1. 读 `$WP_DATA/config/profile.yaml`。若文件不存在，先拷模板再填：`cp "$SKILL/config/profile.yaml.example" "$WP_DATA/config/profile.yaml"`。若 `name`/`position`/`audience`/`style` 任一还是 `TODO`，**先问用户这几个问题再继续**（一次性问全，不要挤牙膏）。
2. 确认本次选题：用户已给主题就用用户的；没给则按定位推荐 3 个选题让用户挑。
3. **防撞题**：`ls $WP_DATA/drafts/*.md` 扫一眼最近几篇的主题——已有同题材未发草稿时提醒用户（同领域两篇要么合并、要么错开几天发，避免同质化）。

## 1. 写稿

- **事实核查（硬性）**：正文里的数据、玩法名、版本内容必须 **≥2 个独立来源交叉核实**（官方公告 > 攻略站当日文 > 社区帖）；搜到但无法交叉验证的爆料词**一律不进正文**。踩过的坑：基于未证实爆料写的草稿（如臆测玩法名）会整篇作废重写。
- **核查 GitHub 开源项目走 `gh api`**（2026-11-24 实测）：WebFetch 对 github.com/raw.githubusercontent.com 会被网络策略挡——`gh api repos/<owner>/<repo>` 拿 star/license，`gh api repos/<owner>/<repo>/contents/<path> --jq '.content' | base64 -d` 直接读 SKILL.md/README 原文（一手来源，比抓网页准），安装命令以仓库 README/marketplace.json 原文为准。
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
- 脚本失败（公众号改版等）：改用 playwright MCP 工具交互式完成同样步骤（登录 → 新建图文 → 填标题/正文 → 保存草稿），并顺手修 `publish.mjs` 里失效的选择器（修完把改动沉淀回插件仓库）。**接管前先判系统性还是偶发**：同版本脚本当天早些时候成功过 → 多为时序/环境偶发，直接 MCP 接管完成发布，别当场大改脚本；连续多次同一步骤挂才是改版信号。
- **MCP 接管 playbook（2026-11-24 v1.2.1 全程实测走通，编辑器 type=77）**：
  1. **先截图判读现场，⚠️≠全丢**：`publish-*.png` 是失败瞬间截图——这次「原创声明状态未确认」实为弹层已开、类型/作者已填，只差协议勾选。浏览器随脚本退出已关，内容靠编辑器自动保存的 appmsgid 草稿兜底。
  2. **免扫码**：MCP playwright 浏览器 profile 自带公众号登录态，导航 `mp.weixin.qq.com` 直达首页（publish.mjs 不落盘原则不变——那是用户自己浏览器 profile 的登录态，勿往脚本里缓存）。「文章」入口点击后编辑页开在新标签页，记得 `browser_tabs` 切过去。
  3. **页面有两个 `.ProseMirror`**：第一个（高 ~30px）是**标题框**，`querySelector('.ProseMirror')` 会把正文贴进标题框——正文必须选「高度>100px」的实例。粘贴用 ClipboardEvent+DataTransfer 派发 `text/html`，md2wx 产物的内联样式全保留（实测 17 p/6 strong/4 h2 无损）。
  4. **run_code_unsafe 沙箱无 `require`**：读不了本地 HTML——大内容用 node 把内容 JSON.stringify 进脚本文件，再 `filename` 参数加载。**生成的脚本只放单个步骤**：这次文件里带了标题输入，与已执行步骤重复，标题打了两遍。填错就地修：聚焦标题框 → Range selectNodeContents 全选 → Backspace → 真实键盘重打。
  5. **原创弹层**（入口 `.js_original_apply` 开关，弹层 `.claim__original-dialog`）：作者框 `keyboard.type` 后计数器在动（6/8）但点「确定」仍报「作者不能为空」——成功路径：真实键入 → **点弹层标题空白触发 blur** → 再点确定。协议勾选是 `i.weui-desktop-icon-checkbox` 自定义图标，只认 `page.mouse` 坐标点击（elementFromPoint 定位）；隐藏 input 的 `checked` 不反映 UI 态，**判状态以截图为准**。弹层里 evaluate 合成 `btn.click()` 不触发框架 handler——一律 `page.mouse`。页面另有视口外隐藏 `#author`，不是校验源，别浪费时间填。
  6. **创作来源（AI 声明）在新编辑器是 checkbox**：`.js_claim_source`（input 藏在 x=-13587），对 input 原生 `.click()` 即生效、无确认弹层——上条 v6.3 的「radio+确认弹层」交互仅 publish.mjs 自己的页面还适用。
  7. **MCP 全局拦截 filechooser**：run_code 里 `waitForEvent('filechooser')` 永远收不到且代码中断（挂 Modal state）——触发 `input.click()` 后让代码停住，用 `browser_file_upload` 工具应答。上传后新图自动带 `selected` class，且 type=77 弹层的 item text **含文件名**（v6.2 的「不含文件名」在此不成立）——文件名硬匹配优先，src 差集兜底，仍不盲选第一项。
  8. **保存验证**：点「保存为草稿」后状态栏「已保存」时间戳可能不刷新，**以首页「近期草稿」更新时间为准**。
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
