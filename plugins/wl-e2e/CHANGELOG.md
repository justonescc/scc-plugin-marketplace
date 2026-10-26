# Changelog — wl-e2e

本插件遵循语义化版本：`MAJOR.MINOR.PATCH`。每个版本发布时打 tag `wl-e2e-v<version>`。

## [0.1.1] — 2026-10-26

### 新增

- **浏览器复用检查（防重复下载）**：skill Pre-flight 新增第 1 条三段判断——pinned chromium
  revision 已在本地则直接用；缺失但本地缓存有其他 `chromium-*` 则通过
  `E2E_CHROMIUM_EXECUTABLE` + `launchOptions.executablePath` 复用（跨 revision 实测可驱动）；
  本地一个都没有才 `playwright install chromium`（首次）。协议不匹配兜底：复用启动报
  CDP 错误时才回退下载。macOS/Linux 缓存路径自适应，`${PKG}` 按包管理器展开。
- `/wl-e2e:init`：Step 1 新增浏览器可用性探测；生成/检查的 `playwright.config.ts` 要求
  支持 `E2E_CHROMIUM_EXECUTABLE`；Step 4 冒烟前置浏览器复用检查。
- Common Mistakes 新增「不检查本地直接 playwright install」条目。

## [0.1.0] — 2026-10-26

首个版本。从 ERP 项目（Vue 3 + Element Plus + vxe-table 前端 / Java Spring Boot 后端）
E2E 实战资产去项目化改造而来：规则与实战教训逐字保留，路径/登录/环境等全部外置为
项目配置，项目专属内容条件化引用。

### 新增

- **skill `e2e-test-pipeline`**：三模式主入口（跑现有不修 / 跑现有+Heal / 生成新测试），
  Pre-flight 五项检查、四代理串行编排、三轮检查、防停滞纪律（600s 看护→恢复一次→主会话接管）、
  Common Mistakes 与 Red Flags
- **command `/wl-e2e:init`**：项目初始化（探测→确认→生成 config/.env/登录 fixture→冒烟指引；
  已有文件一律不覆盖）
- **agent `playwright-linkage-miner`**：Phase 0 联动挖掘（PRD 提 REQ + 后端 Service 挖 LINK，
  四类联动模式、双验证列、file:line 证据；无后端仓库时 REQ-only）
- **agent `playwright-test-planner`**：Phase 1 计划（per-case metadata、Coverage Matrix、
  Difficulty Summary、五禁令、MUST-RECORD）
- **agent `playwright-test-generator`**：Phase 2 生成（mockAndGoto、Login Fixture、形态 C
  跨模块联动、DB 断言 hard rules、Assertion Integrity 反绿化）
- **agent `playwright-test-healer`**：Phase 3 修复（六阶段工作流、单持久浏览器 HARD RULES、
  Scope of Modifications、No Assertion Downgrading）
- **references**：`config-defaults.yaml`（配置模板）、`config-schema.md`（字段表+三层优先级）、
  `auth-fixture-template.ts`（登录 fixture 模板，凭据走 env）、`linkage-assert-either.md`
  （联动双验证 API OR DB 参考实现）
- **内置陷阱表** `known-traps.md`：vxe-table / Element Plus / 芋道系业务接口 / 联动与韧性批次
  （含环境慢窗口、连接重置兜底）

### 已固化的核心规则（继承自实战，不得回退）

- REQ 优先、LINK 补充，两者都必须进 Coverage Matrix
- 联动双验证 API OR DB 任一通过即过（非 AND）
- 反绿化五禁令；三轮检查；MUST-RECORD 禁源码臆造
