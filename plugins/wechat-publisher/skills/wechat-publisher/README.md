# wechat-publisher

微信公众号「AI 写稿 → 排版 → 自动写入草稿箱」的 Claude Code 技能（Skill）。

文章写好后自动进公众号后台**草稿箱**，你只做最后一件事：**点「群发」**。

> 适用于**个人主体订阅号**（无任何官方 API 的账号）。发布靠 Playwright 驱动真实浏览器完成，非接口调用。

## 功能

- 📝 **写稿**：按 `config/profile.yaml` 里的账号定位（主题/读者/风格）生成 800~1500 字文章，标题 3 选 1、摘要 ≤120 字
- 🚫 **合规自检**：自动比对广告法/公众号常见违禁词库并改写
- 🎨 **排版**：Markdown → 公众号内联样式 HTML（15px 正文、主题绿标题、自动适配公众号过滤规则）
- 📥 **发布**：Playwright 打开公众号后台 → 新建图文 → 填标题/作者/摘要 → 粘贴正文 → **保存草稿箱**（支持剪贴板兜底与选择器失效降级）
- 🔐 **安全红线**：脚本绝不触碰「群发」按钮，发布动作永远由账号主人完成

## 安装

```bash
# 1. 克隆到 Claude Code 用户级技能目录
git clone https://github.com/<你的用户名>/wechat-publisher.git ~/.claude/skills/wechat-publisher

# 2. 安装 JS 依赖（只装包，不下载浏览器）
# playwright 固定 1.60.0：它要求 chromium-1223，多数做过 Web 测试的机器缓存里已有；
# 若没有对应缓存，跑一次 npx playwright install chromium 补装
cd ~/.claude/skills/wechat-publisher
npm i -E playwright@1.60.0 marked

# 3. 填写账号定位
cp config/profile.yaml.example config/profile.yaml
# 编辑 config/profile.yaml，填：账号名称/定位/读者/风格/更新频率/范文链接

# 4. 违禁词库已内置（config/banned_words.txt），可在 profile.yaml 里补账号专属禁用词
```

依赖：Node ≥18、Python（可选）、本机 Chromium（`npx playwright install chromium` 可补装）。

## 使用

在 Claude Code 里对话即可：

```
写一篇公众号文章，主题是「xxx」
```

或显式调用 `/wechat-publisher`。

流程：**前置定位检查 → 写稿 → 违禁词自检 → md2wx 排版 → Playwright 写入草稿箱 → 你人工预览并点群发**。

- 每次运行都会弹出浏览器窗口，停在登录页等**管理员微信扫码**；脚本不保存任何登录凭证（登录态不落盘，会话只在本次运行内存里，用完即弃）。
- 保存草稿后脚本输出截图供确认。到手机/后台预览无误后，**人工点群发并勾选「内容由 AI 生成」声明**。

## 目录结构

```
wechat-publisher/
├── SKILL.md                  # 技能指令（Claude 按此执行全流程）
├── scripts/
│   ├── md2wx.mjs             # Markdown → 公众号内联样式 HTML
│   └── publish.mjs           # Playwright 写入公众号后台草稿箱
├── config/
│   ├── profile.yaml.example  # 账号定位模板（复制为 profile.yaml 使用）
│   └── banned_words.txt      # 违禁/高风险词库
└── drafts/                   # 稿件与截图产物（gitignore）
```

## 注意事项

1. **一个身份证只能注册 1 个个人公众号，且个人号不能迁移**——脚本所有写操作都保持低频（每天 ≤1 次），群发永远人工点。
2. 公众号后台改版可能导致 `publish.mjs` 选择器失效：技能流程里内置了降级方案（Claude 用 playwright MCP 交互式完成 + 剪贴板人工粘贴兜底），并顺手修脚本。
3. AI 生成内容需显著标识（《人工智能生成合成内容标识办法》），发布时勾选后台声明。
4. 本项目与微信官方无关，仅供个人学习与效率工具使用，请遵守《微信公众平台服务协议》。

## License

MIT
