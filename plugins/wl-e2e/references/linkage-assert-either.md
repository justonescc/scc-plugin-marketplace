# 联动双验证参考实现 — API OR DB 任一通过即过

跨模块联动用例（形态 C 第 4 步复查）的断言层写法。规则（试点项目已固化，用户裁决）：

> 联动复查 = **API 断言 OR DB 直查断言，任一通过即过**。对方模块查询权限（403）不再是硬依赖；
> DB 断言直接查回写列本身，比 API 的推导值更接近真相源。双失败才 fail。

⚠️ **不是 AND**：两个都过才过会重新引入权限依赖，违背本规则的设计初衷。

Generator 生成形态 C spec 时按本文件模板仿写；`assertEither` / `readTenantId` / `queryRow` 三个
函数建议放 spec 头部或 `<模块>/_db.ts`，供同 suite 复用。

## 1. `assertEither` — OR 语义断言

```ts
/**
 * 联动双验证: API 断言 OR DB 断言,任一通过即过。
 * - API 先跑,过了短路不跑 DB(有权限时最快路径,行为与纯 API 验证完全一致)
 * - API 失败(含 403 无权限/返回 null)自然落到 DB 分支——对方模块查询权限不再是硬依赖
 * - 双失败才 fail,错误信息拼接两侧,保留排障信息
 * - DB 不可达(白名单外/连接失败)时 db 闭包自行抛错 → 退化 API-only
 * 验证开关: E2E_SIMULATE_API_FAIL=1 强制 API 分支失败(模拟 403),
 * 用于实证 DB 分支独立可用(账号有权限时确认 OR 语义真的能落到 DB 侧)
 */
async function assertEither(
  step: string,
  apiAssert: () => Promise<void>,
  dbAssert: () => Promise<void>
) {
  const apiErr = process.env.E2E_SIMULATE_API_FAIL
    ? new Error('模拟 API 失败(E2E_SIMULATE_API_FAIL=1)')
    : await apiAssert().then(
        () => null,
        (e) => e as Error
      )
  if (!apiErr) return
  const dbErr = await dbAssert().then(
    () => null,
    (e) => e as Error
  )
  if (dbErr) {
    throw new Error(`${step} API 与 DB 双验证均失败 → API: ${apiErr.message} | DB: ${dbErr.message}`)
  }
}
```

## 2. `readTenantId` — 从浏览器 localStorage 读租户 id（DB 查询强制租户过滤）

多租户 SaaS 必备：DB 断言的 WHERE 必须带 `tenant_id`，漏了会串到其他租户的数据上误断言。
租户 id 从登录态同源读取（与 API 请求头同源），注意缓存包装格式可能是双重 JSON：

```ts
/** 读 localStorage 的 tenantId(ws-cache 包装格式,与 fetchWithAuth 同源)——DB 查询强制租户过滤 */
async function readTenantId(page: Page): Promise<number> {
  const v = await page.evaluate(() => {
    const raw = localStorage.getItem('tenantId') ?? ''
    try {
      const parsed = JSON.parse(raw)?.v          // ws-cache 包装: { v: "..." }
      const val = typeof parsed === 'string' ? JSON.parse(parsed) : parsed  // 值还可能是 JSON 字符串
      return val == null ? '' : String(val)
    } catch {
      return raw
    }
  })
  const n = Number(v)
  expect(n, 'DB 断言需从 localStorage 读到 tenantId').toBeGreaterThan(0)
  return n
}
```

## 3. `queryRows` / `queryRow` — 只读单表查询（MySQL 示例）

连接信息来源（优先级，凭据只在运行期解析，**绝不打印进日志/错误信息**）：

1. 环境变量 `E2E_DB_URL` / `E2E_DB_USER` / `E2E_DB_PASS`（jdbc:mysql://host:port/db 形式，
   实值放 `.env.e2e.local`，对应 config `db_verify.cred_source`）
2. 后端仓库 dev 配置文件的数据源段（config `backend.repo_path` 下）——与后端 dev profile
   连同一个库，「配置即真相」，不在测试侧重复维护凭据

安全铁律（照抄）：

- 表/列名走**标识符白名单**（`^[a-z0-9_]+$`），条件值全参数化，杜绝 SQL 注入面
- **强制附加 `tenant_id = ?` 与 `deleted = 0`**（多租户 + 逻辑删除列；列名按项目实际）
- 只读：只 SELECT，不 SELECT *（显式列清单）
- 连接错误信息只含 host，不含密码

```ts
const IDENT = /^[a-z0-9_]+$/
function assertIdentifier(name: string): string {
  if (!IDENT.test(name)) throw new Error(`非法标识符: ${name.slice(0, 32)}`)
  return name
}

export async function queryRows(
  table: string,
  where: Record<string, string | number>,
  columns: string[],
  tenantId: number,
  opts: { orderBy?: string; limit?: number } = {}
): Promise<Record<string, unknown>[]> {
  const tbl = assertIdentifier(table)
  const cols = columns.map(assertIdentifier).join(', ')
  const allWhere = { ...where, tenant_id: tenantId, deleted: 0 }   // 强制租户+逻辑删除过滤
  const keys = Object.keys(allWhere).map(assertIdentifier)
  const params = keys.map((k) => allWhere[k])
  const sql =
    `SELECT ${cols} FROM ${tbl} WHERE ` +
    keys.map((k) => `${k} = ?`).join(' AND ') +
    (opts.orderBy ? ` ORDER BY ${assertIdentifier(opts.orderBy)}` : '') +
    (opts.limit != null ? ` LIMIT ${Math.floor(Number(opts.limit))}` : '')
  const conn = await getConnection()   // 惰性单例;失败不缓存下次重建
  const [rows] = await conn.execute(sql, params)
  return rows as unknown as Record<string, unknown>[]
}

/** 单行便捷版:0 行返回 null,多行抛错(条件不够精确) */
export async function queryRow(
  table: string,
  where: Record<string, string | number>,
  columns: string[],
  tenantId: number,
  opts: { orderBy?: string; limit?: number } = {}
): Promise<Record<string, unknown> | null> {
  const rows = await queryRows(table, where, columns, tenantId, { ...opts, limit: 2 })
  if (rows.length > 1) {
    throw new Error(`queryRow 命中 ${rows.length} 行(条件不足): ${table} ${JSON.stringify(where)}`)
  }
  return rows[0] ?? null
}
```

依赖：`mysql2/promise`（或项目数据库对应驱动）。禁用手写 SQL 绕开 `queryRow` 类助手。

## 4. before 快照 + `.catch` 退化

双验证需要**两侧基线**：动作前 API 探测一遍、DB 直查一遍。DB 不可达（白名单外/连接失败）
时 before 快照整体 `.catch(() => null)`，用例退化 API-only，不 fail：

```ts
const tenantId = await readTenantId(page)
const ROW_COLS = ['total_amount', 'checked_amount', 'status']        // 回写列清单(从后端反查)
const dbBefore = await Promise.all([
  queryRow('<源单表>', { no: sourceNo }, ROW_COLS, tenantId),
  queryRow('<目标单表>', { no: targetNo }, ROW_COLS, tenantId)
])
  .then(([source, target]) => ({ source, target }))
  .catch(() => null)   // DB 不可达(连接失败/白名单外) → 退化 API-only

// DB 分支内先判快照可用:
async () => {
  expect(dbBefore, 'DB before 快照不可用(连接失败/白名单外),无法走 DB 分支').toBeTruthy()
  const after = await queryRow('<源单表>', { no: sourceNo }, ROW_COLS, tenantId)
  expect(Number(after!.checked_amount), '审批后 checked_amount 应累加本单金额')
    .toBeCloseTo(Number(dbBefore!.source!.checked_amount) + amount, 2)
}
```

## 5. 表/列名与状态列格式（芋道系/MyBatis Plus 实证，其他 ORM 先核实）

- **表名** = 后端 DO 类 `@TableName` 注解；**列名** = DO 字段驼峰转下划线
  （`checkedAmount` → `checked_amount`）——回写列从对方 ServiceImpl 的 update 语句反查
  （lambdaUpdate 的 `.set(::getXxx, ...)`），**严禁臆造列名**
- **状态列实存枚举常量名字符串**（如 `'PARTIAL_WRITE_OFF'`），不是 Java 侧 0/1/2 数字码
  （MyBatis 默认 EnumTypeHandler 存 `name()`，试点实测证实）。断言写常量名，别写数字
- 金额推进类状态用**动态断言**，写死枚举会碎：
  `after.status === (before.rest - amount > 0.001 ? 'PART_XXX' : 'FULL_XXX')`
- 其他 ORM（JPA/EF 等）存储格式可能不同：生成前先查实际数据或 ORM 序列化配置

## 6. 实证开关（Healer/Generator 自检用）

```bash
# 强制 API 分支失败,实证 DB 分支独立可用:
E2E_SIMULATE_API_FAIL=1 <pkg_manager> exec playwright test <test_dir>/<模块>/linkage.spec.ts -g "联动" --reporter=line
```

跑通 = OR 语义真实生效（DB 侧兜得住）；跑挂且错误是「DB before 快照不可用」= 环境无 DB
访问权，该用例退化为 API-only 属预期，报告注明即可。
