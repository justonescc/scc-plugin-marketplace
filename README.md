# scc-plugin-marketplace

个人 Claude Code 插件市场（Private）。当前提供 **wl-e2e** —— Playwright E2E 测试流水线插件。

## 插件：wl-e2e

从 ERP 项目 E2E 实战沉淀的四代理流水线：**Linkage Miner → Planner → Generator → Healer**，
严格串行、每阶段三轮检查、防停滞纪律。核心理念：以源码与后端代码为事实来源（MUST-RECORD）、
关联需求双来源（PRD 的 REQ 优先 + 后端联动 LINK 补充，全部进 Coverage Matrix）、
反绿化纪律（禁 skip/fixme/BLOCKED 糊弄）、联动双验证（API OR DB 任一过即过）。

### 内容

| 类型 | 名称 | 用途 |
|------|------|------|
| skill | `wl-e2e:e2e-test-pipeline` | 主入口：跑现有测试（不修）/ 跑现有+Heal / 生成新测试 三模式 |
| command | `/wl-e2e:init` | 项目初始化：探测 → 生成 config → 登录 fixture → 冒烟指引 |
| agent | `wl-e2e:playwright-linkage-miner` | Phase 0：PRD + 后端代码挖跨模块联动，产 linkage.map.md |
| agent | `wl-e2e:playwright-test-planner` | Phase 1：测试计划 + Coverage Matrix |
| agent | `wl-e2e:playwright-test-generator` | Phase 2：生成 spec（含跨模块联动形态 C） |
| agent | `wl-e2e:playwright-test-healer` | Phase 3：修复失败用例（不弱化断言） |

### 安装（团队成员）

```bash
# 在 Claude Code 里（对仓库有读权限的账号）：
/plugin marketplace add justonescc/scc-plugin-marketplace
/plugin install wl-e2e@scc-plugin-marketplace
```

装好后在业务项目里先跑一次初始化：

```
/wl-e2e:init
```

它会探测项目结构并生成 `.claude/playwright-test.config.yaml`（路径/登录/环境探查等全部外置，
**每个项目独立可定制**）、`.env.e2e.local` 骨架（凭据，gitignore）、登录 fixture。

### 前置依赖（项目侧）

- Node + Playwright（`@playwright/test` 已安装、chromium 已 `install`）
- 多租户/有权限体系的项目：一个**测试专用低权限账号**（联动用例的 DB 分支正是为无查询权限场景设计的）
- `db_verify.enabled: true` 时：能连测试库（直查只读断言，凭据走 `.env.e2e.local`，推荐只读账号）
- 需要看浏览器操作过程：`headless: false`（有头）是流水线默认约定

### 配置与版本演进

- **配置三层**：会话内覆盖 > 项目 `.claude/playwright-test.config.yaml` > 插件默认（`references/config-defaults.yaml`）。字段说明见插件 `references/config-schema.md`
- **项目专属陷阱**：写进 config 的 `traps_extra`，与插件内置 `known-traps.md` 一并生效；跑绿后沉淀回插件（提 PR + 更新 CHANGELOG）
- **版本**：插件版本见 `plugins/wl-e2e/.claude-plugin/plugin.json`；每个版本改动记录在 `plugins/wl-e2e/CHANGELOG.md`；tag 命名 `wl-e2e-v*`

## 仓库结构

```
.claude-plugin/marketplace.json     # 市场清单（后续新插件按 plugins/<name>/ 平铺）
plugins/wl-e2e/                     # wl-e2e 插件本体
  .claude-plugin/plugin.json
  agents/  commands/  skills/  references/
```
