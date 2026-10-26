/**
 * 登录 fixture 模板 — `/wl-e2e:init` 按项目 config 生成到 `<test_dir>/fixtures/auth.ts`
 * （本文件是模板：`<...>` 占位符由 init 替换为 config 实际值，凭据一律运行期读取，不入库）
 *
 * 设计要点（来自 ERP 试点实测）：
 *   1. 凭据从 process.env / .env.e2e.local 读取 —— 模板与生成的 spec 里都不出现明文
 *   2. hash 路由 goto 不重载文档、存量过期令牌会把 /login 异步弹回主页 → 统一「清 localStorage + reload」
 *   3. 登录成功后落盘 storageState（storageState 方案），playwright.config 检测到文件后自动注入
 *   4. 项目有额外登录步骤（滑块/验证码/租户下拉）→ 在 extraLoginSteps() 里实现
 *
 * 用法（业务 spec 内）：
 *   import { login, STORAGE_STATE_PATH } from '../fixtures/auth'
 *   await login(page)                        // 完整登录 + 落盘登录态
 *   await login(page, { saveState: false })  // 只登录不落盘
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'

/* ---------- 运行期凭据（禁止在此出现明文） ---------- */

// 轻量 .env.e2e.local 读取（无 dotenv 依赖；进程环境变量优先）
function loadLocalEnv(file = '.env.e2e.local'): void {
  try {
    const text = require('node:fs').readFileSync(path.resolve(process.cwd(), file), 'utf-8')
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
    }
  } catch {
    /* 文件不存在则只用进程环境变量 */
  }
}
loadLocalEnv()

export interface LoginOptions {
  tenant?: string
  username?: string
  password?: string
  /** 登录成功后是否保存 storageState */
  saveState?: boolean
  /** 额外登录步骤最大尝试次数（滑块/验证码识别失败自动重试） */
  maxRetries?: number
}

/* ---------- 从 config 映射的常量（init 替换） ---------- */

/** 登录页地址（config: login.url） */
export const LOGIN_URL = '<login.url>'

/** 登录态存储文件（config: login.storage_state；确保 <test_dir>/.auth 已 gitignore） */
export const STORAGE_STATE_PATH = path.resolve(process.cwd(), '<login.storage_state>')

/* ---------- 登录主流程 ---------- */

export async function login(page: Page, opts: LoginOptions = {}): Promise<void> {
  const {
    tenant = process.env.E2E_TENANT ?? '',
    username = process.env.E2E_USERNAME ?? (() => { throw new Error('缺少 E2E_USERNAME（检查 .env.e2e.local）') })(),
    password = process.env.E2E_PASSWORD ?? (() => { throw new Error('缺少 E2E_PASSWORD（检查 .env.e2e.local）') })(),
    saveState = true,
    maxRetries = 5
  } = opts

  // 存量令牌（过期 / refresh-token 已轮换）会让路由守卫把 /login 异步弹回主页，登录表单永不出现。
  // 且守卫跳转是异步的，goto 返回时 url 可能仍停在 /login —— 统一：清 localStorage + reload 强制重读。
  await page.goto(LOGIN_URL)
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  // 填表（定位器来自 config login.fields.*；租户字段按项目有无自行增删）
  await page.locator('<login.fields.tenant>').waitFor({ state: 'visible', timeout: 15_000 })
  if (tenant) await page.locator('<login.fields.tenant>').fill(tenant)
  await page.locator('<login.fields.username>').fill(username)
  await page.locator('<login.fields.password>').fill(password)

  // 项目额外登录步骤（config: login.extra）——滑块验证码、短信验证码等。
  // 需要识别图片的滑块（如 AJ-Captcha blockPuzzle）：底图与拼块小图做模板匹配定位缺口 x，
  // 按人手节奏拖动拖柄；后端只校验最终落点。完整实现参照项目内已有 auth fixture。
  // 若额外步骤在点击「登录」之后触发（弹窗式），把 submit 放到 extraLoginSteps 之前处理。
  await extraLoginSteps(page, maxRetries)

  await page.locator('<login.submit_button>').first().click()

  // 成功判定：URL 离开 /login（hash 路由适用）；按项目改为跳转页/欢迎语断言
  await page.waitForURL((u) => !u.href.includes('/login'), { timeout: 30_000 })

  if (saveState) {
    await fs.mkdir(path.dirname(STORAGE_STATE_PATH), { recursive: true })
    await page.context().storageState({ path: STORAGE_STATE_PATH })
  }
}

/** 额外登录步骤（无则空实现；init 检测到项目有滑块/验证码时在此生成骨架） */
async function extraLoginSteps(_page: Page, _maxRetries: number): Promise<void> {
  /* 空实现：默认项目账号密码直登 */
}
