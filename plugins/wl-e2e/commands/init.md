---
description: 初始化 wl-e2e 插件的项目配置（探测项目结构 → 生成 .claude/playwright-test.config.yaml + .env.e2e.local 骨架 + 登录 fixture → 冒烟指引）。已有文件一律不覆盖。
---

按以下步骤为当前项目做 wl-e2e 初始化。**核心原则：绝不覆盖任何已存在的文件；探测优先、拿不准就问。**

## Step 1 — 探测（只读，不改任何东西）

依次探测并记录结果（全部用 Read/Glob/Grep/Bash 只读命令）：

1. **前端根与包管理器**：找 `package.json` → `packageManager` 字段 / lockfile（pnpm-lock.yaml → pnpm、yarn.lock → yarn、bun.lockb → bun、package-lock.json → npm）；依赖里找 UI 库（element-plus / ant-design-vue / naive-ui…）与表格库（vxe-table…）
2. **views_root / vue_dirs**：`src/views` 是否存在，业务页面按什么域组织（列出一级子目录）
3. **E2E 现状**：`playwright.config.ts` 是否存在；`tests/e2e/`（或 playwright.config 的 testDir）是否存在、下面有哪些模块目录、`fixtures/`、`.auth/`、auth spec 是否已存在；`tests/e2e/.auth` 是否已进 .gitignore
4. **后端仓库**：config 里 `backend.repo_path` 候选——上级目录找同族后端仓库（`*/src/main/java` + `pom.xml`/`build.gradle`）；找不到 → 留空（REQ-only 模式）
5. **登录方式**：找登录页源码（`src/views/Login.vue` 或路由 `/login`）确认字段定位器、有无滑块/验证码（`Verifition`/`captcha` 类组件）、成功跳转判定
6. **已有配置**：项目根 `.claude/playwright-test.config.yaml`、`.env.e2e.local` 是否已存在
7. **DB 直查可行性**：后端 dev 配置文件（`application-dev.yaml` 类）里有无 jdbc 数据源；测试机能否连（不确定就标「待验证」，`db_verify.enabled` 先 false）
8. **浏览器可用性**：探 Playwright 缓存目录（`$HOME/Library/Caches/ms-playwright`，Linux `$HOME/.cache/ms-playwright`，可用 `PLAYWRIGHT_BROWSERS_PATH` 覆盖）下已有哪些 `chromium-<rev>` 目录；跑 `<pkg_manager> exec playwright install chromium --dry-run` 记下 pinned revision。已有任意 chromium → 记「复用模式可用」；一个都没有 → 提示用户首次跑会下载（约 150-300 MB）

## Step 2 — AskUserQuestion（拿探测结果让用户确认）

用 AskUserQuestion 把探测结果分组确认（值有疑点才问，探测明确的不问）：

1. **pkg_manager / ui_lib / test_dir**：探测值作为推荐项
2. **backend.repo_path**：探测到的候选 / 「无后端仓库（REQ-only）」
3. **db_verify.enabled**：默认 false（探测到 dev 配置且网络可达才推荐 true）
4. **登录凭据的 env 变量名**：默认 `E2E_USERNAME` / `E2E_PASSWORD`（+ 多租户项目 `E2E_TENANT`）

## Step 3 — 生成（缺什么补什么，已存在一律跳过）

对每个目标文件先检查存在性；**已存在 → 跳过并在汇总里说明「已存在，未改动」**：

1. **`.claude/playwright-test.config.yaml`**（核心产物）：以插件 `references/config-defaults.yaml` 为模板，填入 Step 1/2 确认的值。敏感值（`login.username`/`login.password`/`db_verify.cred_source`）一律写 `${ENV_NAME}` 引用，不写明文
2. **`.env.e2e.local`**：生成骨架（`E2E_USERNAME=`、`E2E_PASSWORD=` 等，值为空），提示用户自行填真实值并确认它在 `.gitignore`
3. **`.gitignore` 追加**（仅缺失时）：`.env.e2e.local`、`<test_dir>/.auth/`、`test-results/`、`playwright-report/`
4. **登录 fixture**：若 `frontend.fixtures_auth` 为空且无现成 auth spec → 按插件 `references/auth-fixture-template.ts` 生成 `<test_dir>/fixtures/auth.ts`（`<...>` 占位符替换为 config 值，滑块/验证码段留骨架并注明「参照项目内已有实现补全」）+ `<test_dir>/auth/login.spec.ts`（调 `login(page)` + 断言 URL 离开 /login + 断言 storageState 文件含 token key）
5. **`playwright.config.ts` 指引**：若项目无此文件 → 生成最小配置（chromium、`headless: false`、`workers: 1`、storageState 条件注入、testDir 指 `<test_dir>`、`launchOptions.executablePath: process.env.E2E_CHROMIUM_EXECUTABLE || undefined` 支持本地浏览器复用防重复下载）；已有 → 只检查 storageState 注入、testDir 与 executablePath 支持三项是否匹配，不匹配给建议不改文件

## Step 4 — 冒烟指引（生成完给用户可复制的命令清单）

先做浏览器复用检查（pinned revision 已在本地则直接跑；缺失但有其他本地 chromium 则先 `export E2E_CHROMIUM_EXECUTABLE=<该版本可执行文件路径>` 再跑，详见 skill Pre-flight 第 1 条；本地一个都没有才 `<pkg_manager> exec playwright install chromium`）：

```bash
# 1. 填凭据
vim .env.e2e.local

# 2. 首次登录落盘（生成 storage_state）
<pkg_manager> exec playwright test <test_dir>/auth/login.spec.ts --reporter=line

# 3. 最小冒烟：跑一个已有模块（或新生成的 login spec 即冒烟）
<pkg_manager> exec playwright test <test_dir>/auth --reporter=line
```

登录 spec 若挂：按插件 `known-traps.md`（storageState/登录弹回/滑块）排查；仍不通则把失败现场（error-context.md 路径）反馈给助手修 fixture，**不要手改 config 之外的插件文件**。

## Step 5 — 汇总报告

输出初始化汇总：生成了哪些文件、跳过了哪些（已存在）、用户还需做什么（填凭据/跑冒烟/补滑块实现）、config 三层优先级一句话说明（会话内覆盖 > 项目 config > 插件默认）。提醒：后续调路径直接编辑 `.claude/playwright-test.config.yaml`，无需重新 init。
