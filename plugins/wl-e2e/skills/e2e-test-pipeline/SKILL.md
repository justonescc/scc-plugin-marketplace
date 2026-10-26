---
name: e2e-test-pipeline
description: Use when the user asks to run existing Playwright E2E tests, create a Playwright E2E test plan, generate E2E test files, or heal failing E2E tests for a web module (e.g. a business CRUD module under src/views), or asks for the complete E2E pipeline 测试计划+生成测试+修复 with three-pass verification (检查3次). Requires project config .claude/playwright-test.config.yaml (run /wl-e2e:init first if missing).
---

# E2E Test Pipeline（Linkage Miner → Planner → Generator → Healer）

## Overview

四个专家子代理**严格串行**执行（共用一个有头 chromium 会话，绝不能并行），每个阶段结束时做**三轮检查**。核心教训（实测来源：2026-09 采购类合同模块全流程首批试点）：子代理流在浏览器重页面上会停滞，下述防停滞纪律是强制的，不是建议。

「三轮」按阶段含义不同：**计划**三轮 = 三项内容检查（覆盖度/定位器/依赖）；**代码**三轮 = 三项内容检查（tsc/API 核对/陷阱）；**修复**三轮 = 三次独立的全量运行验证。

**关联需求覆盖（用户已固化的优先级规则）**：PRD 里的逻辑/联动（REQ）优先做成用例；PRD 未覆盖的逻辑/联动，用后端代码挖掘出的联动关系（LINK）作为用例来源补充。两者都必须进计划的 Coverage Matrix，不得以「PRD 未写」为由跳过 LINK 条目。Phase 0 联动挖掘产出 `<test_dir>/<模块>/linkage.map.md` 落盘资产。

## 项目配置（每次必读）

所有路径与登录值来自项目根 `.claude/playwright-test.config.yaml`：
`frontend.test_dir`（E2E 根，默认 `tests/e2e`）、`frontend.views_root`、`frontend.vue_dirs`、`frontend.fixtures_auth`、
`login.*`、`project.pkg_manager`（默认 pnpm）、`backend.api_prefix`、`health_check.{url,slow_threshold_ms}`。
**该文件不存在 → 先执行 `/wl-e2e:init`（项目初始化），不要凭猜测继续。**
配置里 `${ENV_NAME}` 引用的敏感值从项目 `.env.e2e.local` 解析后使用，不写进任何落盘 spec。

## 模式选择（**强制首步，必做**）

技能被调用后，**必须先用 AskUserQuestion 让用户选择模式**，再继续任何后续步骤。三种模式互斥，选项标签即用户看到的菜单：

| 模式 | 含义 | 后续路径 |
|------|------|---------|
| **跑现有测试（不修）** | 运行 `<test_dir>/` 下已存在的 spec，收集通过/失败结果，**不**进入修复阶段。适合回归验证 / 改动后冒烟 | Pre-flight → 选模块 → `<pkg_manager> exec playwright test` → 汇总报告 |
| **跑现有 + Heal** | 跑现有测试；若失败走 Phase 3 Healer 修复并三轮验证 | Pre-flight → 选模块 → 跑测试 → 若失败走 Phase 3 |
| **生成新测试** | Plan → Generate，可能含 Heal。新模块/新功能场景 | 用户指定模块 → Phase 0 → Phase 1 → Phase 2 → Phase 3 |

**AskUserQuestion 模板**（模式题直接复用；**模块题的选项必须先扫描生成**——`LS`/`Glob` 列出 `<test_dir>/` 下子目录，排除基建目录（fixtures、auth、specs、.auth、node_modules 等），把业务模块目录作为 options；目录很多时列前 3-4 个 + 「全量」）：

```json
{
  "questions": [
    {
      "question": "你想用哪种模式？",
      "header": "执行模式",
      "options": [
        {"label": "跑现有测试（不修）", "description": "运行 <test_dir>/ 下已存在的 spec，收集通过/失败结果，不进入修复阶段"},
        {"label": "跑现有 + Heal", "description": "跑现有测试，若失败进入 Phase 3 Healer 修复并三轮验证"},
        {"label": "生成新测试", "description": "走 Plan → Generate，可能含 Heal（需先指定目标模块）"}
      ],
      "multiSelect": false
    },
    {
      "question": "目标模块（跑模式只支持 <test_dir>/ 下已存在的目录）",
      "header": "目标模块",
      "options": [
        {"label": "<模块A目录名>（已存在）", "description": "<test_dir>/<模块A>/，<一句话说明>"},
        {"label": "<模块B目录名>（已存在）", "description": "<test_dir>/<模块B>/，<一句话说明>"},
        {"label": "全量 <test_dir>/", "description": "<test_dir>/** 下所有 spec（含 auth、fixtures、smoke）"}
      ],
      "multiSelect": false
    }
  ]
}
```

**未明确时的兜底** — 若用户直接说"跑一下"或"测试"而无具体指向：默认走 **跑现有 + Heal**，目标取 `<test_dir>/` 下扫描到的第一个业务模块（多个时用上面的模块题让用户选）。生成新测试永远需要显式模块。

输入（仅生成新模式）：目标模块（如 `销售合同` / `<views_root>/contract/sale`）。未提供时先从 `<views_root>/` 推断候选并与用户确认。产出目录命名 `<test_dir>/<views域名>-<子模块>/`（如 `contract/sale` → `tests/e2e/contract-sale/`）。

## Pre-flight（每次必做）

1. **令牌新鲜度**：`<login.storage_state>` 指向的 storage state 文件距上次生成超过 ~30 分钟 → 先删掉它，重跑登录 spec（auth fixture 会重新落盘；登录实现见 `frontend.fixtures_auth`）。refresh-token 有轮换：任何一次刷新后旧文件即失效。
2. 确认 `playwright.config.ts`：chromium、`headless: false`（用户要看浏览器）、storageState 自动注入。
3. 定位模块：读 `<views_root>/<域>/` 的 index.vue 与共享组件，记下路由 URL（hash 模式，`#/xxx`）和菜单路径。
4. **联动资产新鲜度**（仅生成新模式）：`<test_dir>/<模块>/linkage.map.md` 若已存在，检查其头部「模块信息」里的后端 Service 文件与 PRD 版本是否仍是当前版本（后端大改/PRD 换版 → 重跑 Phase 0 增量更新；未变 → 直接复用，跳过 Phase 0）。
5. **环境健康**（跑测试模式）：测试环境慢窗口（API 单请求超过 `health_check.slow_threshold_ms` / 页面卡加载）会让全量连环超时——先 curl 探 `health_check.url` 延迟，异常时告知用户择时重跑或加 `--retries=2`，不要盲目归因为用例缺陷。

## Phase 0 — Linkage Miner（playwright-linkage-miner 代理，仅生成新模式且资产缺失/过期时）

产出 `<test_dir>/<模块>/linkage.map.md`（落盘资产，Planner/Generator 的输入）：第 1 节 REQ 清单（PRD 提取）+ 第 2 节 LINK 联动矩阵（后端 Service 挖掘：正向回写/反向扣回/反向拦截/MQ 同步，每条带 `文件:行号` 证据与置信度；**验证方式含双列——API 与 DB（`表.字段 → 期望变化`，状态列标枚举常量名而非数字码，回写列从对方 ServiceImpl 反查）**，双验证规则起生效）+ 第 3 节运行时探索记录 + 第 4 节待人工确认项。只读代码不跑浏览器；形态与分组见 miner 代理内说明（项目内若已有已验证的 linkage.map.md，参照其表格列与写法）。

**停滞回退**：子代理停滞两次 → 主会话直接挖掘（Grep 后端 Service 的跨模块调用 + PRD 逐条提炼），产物格式不变。

## 跑现有测试（模式：「跑现有（不修）」/「跑现有 + Heal」）

**目标模块校验**：路径必须落在 `<test_dir>/<已存在模块>/`；若用户给的是 `<views_root>/...` 源码路径，先映射到对应 `<test_dir>/<视图域>-<子模块>/`。找不到对应目录 → 用 AskUserQuestion 列出 `<test_dir>/` 下已存在的子目录让用户选。

### 步骤 1：实跑全量

```bash
# 跑现有测试（有头，用户可观览）
<pkg_manager> exec playwright test <test_dir>/<模块> --reporter=line
# 全量
<pkg_manager> exec playwright test --reporter=line
```

收集 `test-results/*/error-context.md`（失败用例的现场快照与控制台日志）。

### 步骤 2：模式分支

- **跑现有（不修）**：汇总 pass/fail 列表 + 各用例耗时，**直接结束**。不进入 Phase 3。
- **跑现有 + Heal**：若全部通过 → 汇报"三轮绿"并结束；若有失败 → 进入 **Phase 3 — Healer**（不跳 Planner/Generator）。

### 报告模板

```
== 跑测试报告 ==
模块: <test_dir>/<模块>
命令: <pkg_manager> exec playwright test ... --reporter=line
通过: X / Y
失败: Z（list: 用例名 → 失败原因摘要）
磁盘现场: test-results/<失败用例>-*/error-context.md
下一步: 进入 Phase 3 Healer（仅跑+heal 时）
```

## Phase 1 — Planner（playwright-test-planner 代理）

提示词必备要素：**以源码为准**（列表/表单/详情组件 + API 目录）、浏览器只做轻量验证（**严禁打开重型新增抽屉**，曾致连续三次流式停滞）、seed 优先用现成的 `<test_dir>/seed.spec.ts`（存在时）、计划存 `<test_dir>/<模块>/test.plan.md`（含用例→spec 文件映射、依赖顺序、API 断言、Difficulty）。**输入含 Phase 0 联动资产**：每条用例带 `Covers: REQ-xx/LINK-xx`，计划末尾出 **Coverage Matrix**（REQ/LINK → 承接用例 双向可追溯；仅联动图自身标 E2E-N/A 的条目可标 N/A；项目内已有已验证 plan 时参照其 §Coverage Matrix）。跨模块联动用例单独成 suite（形态 C，见 Generator 节）。

**计划三轮检查**：
1. **覆盖度**：源码里的按钮/操作/API 是否都有用例，有无臆造功能；**Coverage Matrix 无遗漏行**（每条 REQ/LINK 都有承接用例或 N/A 标注）
2. **定位器真实性**：计划引用的 placeholder/label 是否已在组件源码 grep 核实
3. **依赖与顺序**：数据依赖（谁创建、谁消费、谁清理）、执行顺序（workers=1 按文件名字母序）、API 端点拼写

**停滞回退**：Planner 停滞两次 → 主会话直接按源码产出计划（grep 组件结构 + API 文件，浏览器只轻量验证路由），不再依赖子代理。

## Phase 2 — Generator（playwright-test-generator 代理）

按 suite 串行派发；要求**每完成一个用例立即 generator_write_test 落盘**；项目内已有 spec 助手（如 `itemSelect`/`cellByTitle`/`clickWhenSettled`/`openOwnOptions` 类函数）优先直接复制改造，没有则按 generator 代理内的模板新建；spec 不含登录步骤（storageState 已配）。**联动 suite（形态 C：API 铺因 → UI 触发 → 双验证复查 API OR DB，任一通过即过）**生成规则见 `playwright-test-generator.md` 的 Cross-module Linkage Cases 节；`assertEither` OR 模板、`readTenantId` 解包、DB before 快照 `.catch` 退化等参考实现见插件 `references/linkage-assert-either.md`（项目内若已有跑绿的联动 spec 与 `_db.ts`/`_helpers.ts`，优先参照项目内的）。DB 分支独立可用性用 `E2E_SIMULATE_API_FAIL=1` 实证。

**代码三轮检查**：
1. `npx tsc --noEmit --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom <test_dir>/<模块>/*.spec.ts`
2. 对照计划逐条核对步骤与 API（特别：`update` 要排除 `update-status`；waitForResponse 必须在动作**前**注册）
3. UI 库/表格库陷阱复查 → 逐条对照本 skill 目录 `known-traps.md` + 配置里的 `traps_extra`

**停滞回退**：子代理停滞（600s 看护）→ 恢复一次（"从断点继续"）→ 再停滞 → 放弃子代理，主会话直接写 spec（已验证可行且更稳）。

## Phase 3 — Healer（playwright-test-healer 代理）

**触发条件**：
- 「生成新测试」模式：Phase 2 Generator 写完 spec 后**自动跑全量**收集失败 → 进入 Healer 修复
- 「跑现有 + Heal」模式：跑现有测试发现失败 → 直接进入 Healer（**不**跳 Planner/Generator）
- 「跑现有（不修）」模式：**永不触发**

先实跑全量收集失败（`--reporter=line`），把失败清单 + `test-results/*/error-context.md` 磁盘路径交给 healer，并写入防停滞纪律与已知陷阱表。要求：只修定位器/等待/文案，**不得弱化断言**；修一个用例立刻单跑验证（`-g "用例名"`）。

**三轮验证**：修复后全量绿 → 再全量绿一次 → 主会话独立复跑一次绿。偶发抖动（如 hover 未展开）不许靠重跑糊弄，加重试机制根治。

## 防停滞纪律（所有阶段强制）

- **停滞处置（适用于任一阶段的任何子代理）**：停滞（600s 看护）→ 恢复一次（"从断点继续"）→ 再停滞 → **放弃该子代理，主会话接管该阶段**（Planner→主会话直接产出计划；Generator→主会话直接写 spec；Healer→主会话自己修复），不要继续恢复第三次
- **严禁**对打开的表单抽屉做整页 snapshot；定位只用限定 target 的小范围快照
- 信息源优先级：磁盘 `error-context.md` > 源码 grep > 小范围快照
- 每步之间文字输出 1-2 句以内，快速推进
- MCP 浏览器可能崩溃（"Test has already stopped"）→ 改用真实 runner + 磁盘现场完成诊断

## Common Mistakes

| 错误 | 后果 |
|------|------|
| 四个 suite 并行派发生成代理 | 共用单浏览器会话，互相打架 |
| 生成后直接交付不跑 tsc | `await` 层级错误这类低级 bug 混进去 |
| 计划里写臆造的 placeholder | 首轮大面积失败 |
| 只跑一轮全量就宣布完成 | 偶发抖动被掩盖 |
| **跳过模式选择直接开干** | 用户要的是「跑现有」结果跑了 Planner 浪费数分钟；或用户要 Heal 结果跳过了修复 |
| **「跑现有（不修）」模式偷偷进 Phase 3** | 用户明确说不修，结果被自动修复，越权 |
| **「跑现有 + Heal」全绿后没复跑两次就交付** | 与生成模式相同：三轮验证不可省 |
| **跳过 Phase 0 直接 Planner**（生成模式且 linkage.map.md 缺失、backend 可用时） | 跨模块联动永远测不到，Coverage Matrix 无 LINK 行可追溯 |
| **以「PRD 未写」为由跳过 LINK 条目** | 违反用户固化优先级规则：REQ 优先、LINK 必须补充进 Coverage Matrix |
| **环境慢窗口把连环超时当用例缺陷修** | 先探环境延迟（Pre-flight 第 5 条），环境级失败（全部超时、无断言/定位错误）择时重跑或 `--retries=2`，别乱改用例 |
| **DB 断言漏 tenant_id/deleted 过滤或手写 SQL 绕开 queryRow 类助手** | 串租户数据误判——queryRow 已强制注入 `tenant_id = ? AND deleted = 0`，禁止绕开 |
| **双验证写成 AND 语义（两个都过才过）/ DB 状态列按数字码断言** | 规则是 API OR DB **任一通过即过**（AND 会重新引入权限依赖）；DB 状态列实存枚举名（如 `'PARTIAL_WRITE_OFF'`）不是数字码 |

**Red Flags**：跳过 Pre-flight 直接开跑 / 跳过模式选择直接进 Planner / 配置文件缺失仍凭猜测继续 / 子代理停滞两次仍在恢复 / 宣布完成时拿不出三轮绿色运行记录 —— 停下来回到对应阶段。

## 陷阱速查

组件库/表格库/令牌等已验证陷阱与修法见本目录 `known-traps.md`（通用层陷阱 +芋道系业务示例；写生成提示词时直接粘给代理）。项目专属陷阱写在配置的 `traps_extra`，一并粘给代理。
