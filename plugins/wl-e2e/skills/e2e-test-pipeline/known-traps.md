# Known Traps — E2E 测试已验证陷阱表

来源：ERP 项目试点全流程实测（每条都踩过并验证过修法）。写生成/修复提示词时把本表直接粘给代理。跨模块联动（形态 C）批次见文末「联动/韧性批次」。

> **项目专属陷阱**：本表是通用层（组件库/表格库/Playwright 层）+ 芋道系业务示例。项目踩到的新陷阱写在项目 config（`.claude/playwright-test.config.yaml`）的 `traps_extra` 数组里，与本表一并粘给代理；跑绿后欢迎沉淀回本表（提 PR/CHANGELOG）。

## vxe-table 陷阱

| 陷阱 | 修法 |
|------|------|
| **固定列是三份独立 DOM**：主表 `.vxe-table--main-wrapper`、固定左列 `.vxe-table--fixed-left-wrapper`、固定右列 `.vxe-table--fixed-right-wrapper`，行序对齐但内容按列分布 | 编号链接→固定左列副本行；操作按钮→固定右列副本行；按名称/文本筛行→主表副本。在主表行上找编号/按钮永远找不到 |
| 行编辑默认**双击**触发（`editConfig trigger: 'dblclick'`），单击进入不了编辑态 | 双击单元格后再操作内部 input |
| `edit-closed` 按"最后激活列"回调计算（如明细总价联动） | 结束编辑前先激活目标列（如双击「不含税单价」再填值），否则无计算分支、总价恒 0 |
| 空态文案「暂无数据」主表+合计表各渲染一份 | `getByText('暂无数据').first()` 或 `.vxe-table--empty-content:visible` |
| 分页是 `vxe-pager`（`.vxe-pager--next-btn`），不是 el-pagination | 不要用 `.el-pagination .btn-next` |
| 连续操作后 el-message 提示叠放 | 断言最新一条用 `.first()` |

## Element Plus 2.9 陷阱

| 陷阱 | 修法 |
|------|------|
| 空值下拉的占位文本渲染在 span（`el-select__placeholder`），**无 placeholder 属性**，`getByPlaceholder` 定位不到 | 按 form-item label 结构定位：`.el-form-item` filter hasText → `.el-select`（项目内 spec 的 `itemSelect` 类助手即此写法），选中后仍可凭 label 复位 |
| 多个下拉面板（含弹窗自动弹出的）同时存在时，全局 `.el-select-dropdown:visible` 会窜到别的面板 | 经 `input[aria-controls]` 拿到该 select 自己的面板 id，`#panelId .el-select-dropdown__item`（见 `openOwnOptions` 类助手） |
| 面板 zoom 过渡期内元素瞬时不可见/不稳定，点击偶发不中 | `clickWhenSettled`：短超时(1.5s)循环重试点击 |
| el-dropdown 不写 trigger 时默认 **hover** 触发，click 可能不展开菜单 | `hover()` + 菜单可见等待，偶发不展开时加重试循环（有头窗口被遮挡会渲染冻结） |
| `el-message-box` 确认按钮文案是「确定」，抽屉底按钮是「确 定」（带空格） | 统一用 `/确\s*定/` 正则匹配 name |

## 业务/接口陷阱（芋道系示例，其他后端栈按实际调整）

| 陷阱 | 修法 |
|------|------|
| **401 首响应**：axios 层收到 401 会刷新令牌并自动重发原请求，`waitForResponse` 捕到的是首个探测响应 | 等待最终重发的响应再断言 code=0；同步 predicate + 显式重等（async predicate 会挂起 worker 2×300s） |
| `PUT update` 与 `PUT update-status` URL 前缀互相包含 | update 断言加 `!url.includes('update-status')` |
| 反审批走 BPM：`POST /bpm/task/back`（`commonTaskBack`），不是 update-status | 按源码实际实现断言 |
| 重复运行创建用例会积累多条同名数据 | 删除/清理用例循环删所有匹配行，断言剩余数递减 |
| storageState 会在**每次文档加载**重新注入 localStorage；hash 路由 `goto` 不重载文档 | 登录弹回场景须 `page.reload()`；令牌过期须删文件重跑 login.spec |

## 联动/韧性批次（跨模块联动试点实测）

### 跨模块联动用例（形态 C：API 铺因 → UI 验果 → API 复查）

| 陷阱 | 修法 |
|------|------|
| **create 接口只返回 id**，且新建单据不在当前 Tab 的列表刷新响应里 | create 响应拿 id → `GET <模块>/get?id` 取单号/明细；不要指望 waitForResponse 捕列表刷新 |
| **列表 Tab 按单据 type/category 隔离**（如某类核销单不出现在另一类 Tab），UI 行操作前必须切 Tab | 共享 `switchXxxTab(page, row)` 类 helper：按行 category/type 算目标 Tab，`aria-selected` 判断已选中（重复点击不触发请求，waitForResponse 会挂），否则点击 + 等 page 请求带对应参数 |
| 回写断言基准要从**单据明细实际选中行**取（选择弹窗排序 ≠ 探测接口排序） | 建单后 get?id 读 `sourceItems[0].no` / `targetItems[0].no` 再做 before 快照 |
| 金额推进状态断言写死枚举会碎 | 动态断言：`after.status === (before.unChecked - amount > 0.001 ? 'PART_XXX' : 'FULL_XXX')`（枚举常量名按项目实际状态机） |
| **反审批联动占用**：残留的已审核核销单会占用源单，导致后续「反审批放行」断言被拦截（接口 600） | 每个联动用例开头幂等清理 E2E 残留单（已审核先 API update-status 反审批释放占用，再 delete） |
| 探测无配对数据时 fail 不如 skip | `test.skip(!pair, '环境无 xx 配对数据,跳过 xx 用例')` + 汇报清单 |

### vxe / EP 追加

| 陷阱 | 修法 |
|------|------|
| **el-radio-button** 的 input（original-radio）被 `<span class="el-radio-button__inner">` 拦截 pointer events | 点外层 `locator('.el-radio-button').filter({ hasText: '目标视图' })`，不要点 role=radio |
| **vxe 双表结构因视图而异**：有固定列时三份 DOM（见上表）；无固定列视图（如聚合视图）整行（含操作列）在单一 body 行，表头与 body 同层 | 先看 error-context 快照确认结构再定定位策略；聚合行 `.vxe-body--row` filter hasText + `.first()` |

### JS / Playwright 层

| 陷阱 | 修法 |
|------|------|
| helper 返回 `Promise<Locator>` 时 `.count()` 需要**双层 await** | `await (await rowActionButton(page, no, name)).count()` |
| **page.evaluate 回调上下文**：回调内引用的变量必须全部通过第二实参传入 | 签名 `async ({ url, params, method }) =>` 与实参 `{ url, params, method }` 同步改，漏一个就是 ReferenceError |
| 浏览器内探测凭证不落 transcript | `page.evaluate` 内读 localStorage 组 headers，只返回业务 JSON；token/密码不 console.log、不写文件 |
| **测试环境偶发连接重置**（`TypeError: Failed to fetch` / waitForResponse 超时但请求实际已到达并生效，留下状态残留假失败） | ① fetchWithAuth 捕 `Failed to fetch` 重试 ≤3 次（只重网络层失败，不重发已到达的写请求）；② 状态流转 waitForResponse 超时后**兜底查实际单据状态**，已是目标状态则按成功处理；③ SPA 卡加载页时每轮失败整页重载重试（显式 timeout，勿用默认=test 剩余时间） |
| 环境慢窗口全量跑会连环超时 | `--retries=2` 跑法吸收瞬时故障；判定「环境级失败」（全部超时、无断言/定位错误）时先 curl 探环境再重跑，勿盲目改用例 |

## 常用命令

路径与包管理器按项目 config：`<pkg_manager>`（默认 pnpm）、`<test_dir>`（默认 `tests/e2e`）。

```bash
# 全量（有头，用户可观览）
<pkg_manager> exec playwright test <test_dir>/<模块> --reporter=line
# 单用例
<pkg_manager> exec playwright test <test_dir>/<模块>/xxx.spec.ts -g "用例名" --reporter=line
# 类型检查（spec 文件）
npx tsc --noEmit --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom <test_dir>/<模块>/*.spec.ts
# 重新登录落盘（先删 <test_dir>/.auth/storage_state.json）
<pkg_manager> exec playwright test <login.spec 路径（config 的 frontend.fixtures_auth 同目录）>
```
