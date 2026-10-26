# 配置 Schema — `.claude/playwright-test.config.yaml`

项目配置是插件所有路径与凭据的**唯一事实来源**。四个 agent 与 skill 的第一步都是读它；文件缺失 → 先跑 `/wl-e2e:init`。

## 三层优先级（高 → 低）

1. **会话内覆盖**：主会话派发 agent 时显式指定的值（如临时指定模块）
2. **项目配置**：项目根 `.claude/playwright-test.config.yaml`
3. **插件默认**：`references/config-defaults.yaml`

## 字段表

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `project.name` | string | 目录名 | 项目名，用于报告标题 |
| `project.language` | string | `zh` | 计划/联动图产出语言（代码标识符保持原文） |
| `project.pkg_manager` | string | `pnpm` | `pnpm` / `npm` / `yarn` / `bun`；跑测试命令统一 `<pm> exec playwright test` |
| `project.ui_lib` | string | — | 主 UI 组件库（element-plus / ant-design-vue / naive-ui…）；agent 提示词按此适配定位器策略 |
| `frontend.root` | string | `"."` | 前端仓库根，相对 config 所在项目根；前后端同仓时 `"."` |
| `frontend.vue_dirs` | string[] | `src/views`, `src/components` | Vue SFC 扫描目录（相对 frontend.root） |
| `frontend.views_root` | string | `src/views` | 业务页面根，模块定位入口 |
| `frontend.test_dir` | string | `tests/e2e` | E2E 根：`<test_dir>/<模块>/` 下放 spec、`test.plan.md`、`linkage.map.md` |
| `frontend.fixtures_auth` | string | 空 | 登录 fixture/spec 路径；空 = 尚未创建（init 会生成） |
| `backend.repo_path` | string | 空 | 后端仓库路径（相对 frontend.root）。**空 → Linkage Miner 输出 REQ-only，Generator 跳过形态 C** |
| `backend.module_glob` | string | `**/module-*` | 后端业务模块目录 glob |
| `backend.api_prefix` | string | 空 | REST 前缀（如 `/admin-api`）；mock route 写 `**${API_PREFIX}/xxx**` |
| `health_check.url` | string | 空 | 被测环境入口 URL，Pre-flight 探延迟用；空 = 跳过 |
| `health_check.slow_threshold_ms` | number | `3000` | 超过视为慢窗口，提示择时重跑 / `--retries=2` |
| `login.url` | string | — | 登录页完整 URL |
| `login.fields.username` | string | `input[name="username"]` | 用户名输入框定位 |
| `login.fields.password` | string | `input[type="password"]` | 密码输入框定位 |
| `login.submit_button` | string | `button[type="submit"]` | 提交按钮定位 |
| `login.username` | string | — | **支持 `${ENV_NAME}` 引用**，实值在 `.env.e2e.local` |
| `login.password` | string | — | 同上，禁止明文入 config |
| `login.storage_state` | string | `<test_dir>/.auth/storage_state.json` | 登录态落盘文件 |
| `login.extra` | object | `{}` | 项目额外登录步骤（滑块/验证码/预点击等），由 auth fixture 处理 |
| `db_verify.enabled` | bool | `false` | `true` 时联动用例（形态 C）可出 DB 断言分支 |
| `db_verify.cred_source` | string | 空 | 连接信息来源说明或 `${ENV}` 引用（如 `.env.e2e.local` 的 `E2E_DB_DSN`）。真实凭据不落任何仓库文件 |
| `db_verify.notes` | string | 空 | 驱动/只读账号/状态列存储格式（枚举名 vs 数字码）备注 |
| `traps_extra` | string[] | `[]` | 项目专属陷阱，与 `known-traps.md` 一并粘给代理 |

## `${ENV_NAME}` 引用与 `.env.e2e.local`

任何字段值可写 `${ENV_NAME}`。运行时解析顺序：进程环境变量 → 项目根 `.env.e2e.local`（`KEY=value` 一行一个）。

```
# .claude/playwright-test.config.yaml（入库，无敏感值）
login:
  username: "${E2E_USERNAME}"
  password: "${E2E_PASSWORD}"

# .env.e2e.local（gitignore，绝不入库）
E2E_USERNAME=zhangsan
E2E_PASSWORD=真实密码
```

规则：
- 生成 spec 时 `${ENV}` 必须先解析为运行期从 `process.env` 读取的写法（见 `auth-fixture-template.ts`），**解析后的明文不得写进任何落盘 spec**
- `.env.e2e.local` 由 `/wl-e2e:init` 创建骨架；`db_verify.cred_source` 同样只放 `${ENV}` 引用或「到哪找」的指引，不放 DSN 本体

## 修改配置

直接编辑项目根 `.claude/playwright-test.config.yaml` 即可，无需重新安装插件。改完在下一轮 agent/skill 调用时自动生效（它们每次都重新读文件）。
