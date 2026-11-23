#!/usr/bin/env node
// 把排版好的 HTML 写入微信公众号后台「草稿箱」（不群发！群发永远人工点）
// 用法: node publish.mjs <article.html> --title "标题" [--digest "摘要"] [--author "笔名"] [--cover /path/封面] [--headless]
// v2: 适配新版图文编辑器（真实剪贴板 Cmd+V 粘贴、「保存为草稿」按钮、contenteditable 标题）
// v3: 安全策略——不保存任何登录凭证（登录态不落盘），每次发布都要求管理员微信扫码
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 截图等运行状态外置到 ~/.wechat-publisher，插件升级重装不丢失（登录凭证例外：不保存，每次扫码）
const DATA = path.join(os.homedir(), '.wechat-publisher');
const args = process.argv.slice(2);
const htmlFile = args[0];
if (!htmlFile || !fs.existsSync(htmlFile)) {
  console.error('用法: node publish.mjs <article.html> --title "标题" [--digest "摘要"] [--author "笔名"] [--cover 封面图] [--headless]');
  process.exit(1);
}
const opt = (k) => { const i = args.indexOf('--' + k); return i > -1 ? args[i + 1] : undefined; };
const title = opt('title') || path.basename(htmlFile, '.html');
const digest = opt('digest');
const author = opt('author');
const cover = opt('cover');
const headless = args.includes('--headless');

fs.mkdirSync(path.join(DATA, 'config'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'drafts'), { recursive: true });
const shotPath = path.join(DATA, 'drafts', `publish-${Date.now()}.png`);
const html = fs.readFileSync(htmlFile, 'utf8');
const probe = html.replace(/<[^>]+>/g, '').replace(/\s+/g, '').slice(0, 12); // 正文开头纯文本，用于验证粘贴
const log = (...a) => console.log('[发布]', ...a);

const browser = await chromium.launch({ headless });
// 全新无痕 context：不带任何历史 cookie/localStorage，每次都是干净登录
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://mp.weixin.qq.com' });
const page = await ctx.newPage();

// 1) 打开后台等扫码（每次发布都强制扫码，不在本地留下任何登录凭证）
log('打开 mp.weixin.qq.com …');
await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
log('🔑 请在浏览器窗口里用管理员微信扫码登录（等 180 秒），扫码后记得在手机上确认…');
try {
  await page.waitForURL(/cgi-bin\/home|cgi-bin\/framewolf|apppage/, { timeout: 180_000 });
  log('扫码登录成功 ✓（会话仅存在于本次运行内存中，不落盘）');
} catch { await die('等待扫码超时'); }

// 2) 进入图文编辑页
let token = await page.evaluate(() => {
  try {
    const w = window.wx?.commonData;
    return w?.data?.t || w?.token || new URLSearchParams(location.search).get('token') || '';
  } catch { return ''; }
});
if (token) {
  log('拿到 token，直达编辑器 …');
  await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&type=77&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
}
if (!token || !(await page.$('textarea, div[contenteditable="true"], iframe'))) {
  log('⚠️  请在浏览器窗口里手动点：「新的创作」→「写新图文」，脚本会自动继续（等 120 秒）…');
  try { await page.waitForURL(/appmsg|edit/, { timeout: 120_000 }); }
  catch { await die('等待进入编辑页超时'); }
}
log('已进入编辑页 ✓');

// 3) 填标题：编辑器异步渲染，等 #title 真正出现再填（实测盲等 3 秒不够）
try {
  await page.waitForSelector('#title', { state: 'visible', timeout: 30_000 });
  await page.fill('#title', title);
  log('标题已填 ✓');
} catch {
  try {
    const tb = page.locator('textarea[placeholder*="标题"], div[contenteditable="true"][data-placeholder*="标题"]').first();
    await tb.click({ timeout: 5_000 });
    await page.keyboard.type(title, { delay: 20 });
    log('标题已填（备选框）✓');
  } catch { log('⚠️  标题输入框没找到，请手动填标题'); }
}
const titleSel = '#title';

// 4) 填作者（可选）
if (author) {
  try { await page.locator('#author, input[placeholder*="作者"]').fill(author, { timeout: 5_000 }); log('作者已填 ✓'); } catch {}
}

// 5) 正文：真实系统剪贴板 + Cmd+V（新版编辑器只认真实粘贴）
//    编辑区可能在主文档（.ProseMirror / contenteditable）或 iframe（ueditor）里，逐个尝试
async function pasteInto(locator, label) {
  await locator.click({ timeout: 8_000 });
  await page.evaluate(async (html) => {
    const item = new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) });
    await navigator.clipboard.write([item]);
  }, html);
  await page.keyboard.press('Meta+V');
  await page.waitForTimeout(2500);
  const ok = await contentContains(probe);
  if (ok) log(`正文已粘贴 ✓（经 ${label}）`);
  return ok;
}
async function contentContains(text) {
  for (const frame of [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame())]) {
    try {
      if (await frame.getByText(text.slice(0, 8), { exact: false }).first().isVisible({ timeout: 1500 })) return true;
    } catch {}
  }
  return false;
}
let pasted = false;
try {
  // 尝试 1：iframe 编辑器（ueditor 等）
  const editFrames = page.frames().filter(f => f !== page.mainFrame() && /ueditor|editor/i.test(f.url()));
  for (const f of editFrames) {
    if (await pasteInto(f.locator('body[contenteditable="true"], body').first(), `iframe:${f.url().slice(0, 60)}`)) { pasted = true; break; }
  }
  // 尝试 2：主文档 contenteditable 编辑区（排除标题框）
  if (!pasted) {
    const region = page.locator(`.ProseMirror, div[contenteditable="true"]`).filter({ hasNot: page.locator(titleSel) }).last();
    if (await pasteInto(region, '主文档编辑区')) pasted = true;
  }
} catch (e) {
  log('粘贴过程异常:', e.message?.slice(0, 120));
}
if (!pasted) {
  log('⚠️  自动粘贴未确认成功：请在正文区手动 Cmd+V 粘贴（剪贴板里已有排版 HTML），等待正文出现…（最多 180 秒）');
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), probe, { timeout: 180_000 });
    log('检测到正文 ✓（手动粘贴成功）');
  } catch { await die('正文始终未出现'); }
}

// 6) 摘要（新版在「设置」里，先试常见输入框）
if (digest) {
  const digestBox = page.locator('#digest, textarea[placeholder*="摘要"], textarea[placeholder*="选填"]').first();
  try { await digestBox.fill(digest, { timeout: 8_000 }); log('摘要已填 ✓'); } catch { log('（摘要输入框未找到，可在保存弹窗里填）'); }
}

// 7) 保存为草稿（新版按钮文案）
const saveBtn = page.locator('button:has-text("保存为草稿"), [role="button"]:has-text("保存为草稿"), button:has-text("保存"):not(:has-text("群发"))').first();
try {
  await saveBtn.click({ timeout: 10_000 });
  await page.waitForTimeout(3000);
  log('已点击「保存为草稿」✓');
} catch { log('⚠️  保存按钮没点到，请手动点「保存为草稿」'); }

// 8) 封面（可选）
if (cover && fs.existsSync(cover)) {
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 8_000 }),
      page.locator('text=上传封面, .js_upload:has-text("上传")').first().click({ timeout: 8_000 }),
    ]);
    await chooser.setFiles(cover);
    await page.waitForTimeout(3000);
    log('封面已上传 ✓');
  } catch { log('⚠️  封面自动上传失败，请在弹窗里手动选'); }
}

// 9) 等保存完成（宽松等待，期间用户可手动补封面/摘要）
try {
  await page.waitForFunction(() => {
    const t = document.body.innerText;
    return t.includes('保存成功') || t.includes('已保存') || t.includes('保存为草稿成功');
  }, { timeout: 180_000 });
  log('保存完成 ✓');
} catch { log('⚠️  未检测到「保存成功」提示，请在窗口里确认已保存'); }

await page.screenshot({ path: shotPath, fullPage: false });
log('截图: ' + shotPath);
log('✅ 请到公众号后台/手机预览确认（标题、正文、封面齐全），然后人工点「发表」，并勾选「内容由 AI 生成」声明。');
await browser.close();
process.exit(0);

async function die(msg) {
  await page.screenshot({ path: shotPath }).catch(() => {});
  log('❌ ' + msg + '，截图: ' + shotPath);
  log('兜底方案：剪贴板里已有排版 HTML，人工打开后台粘贴发布；或改用 playwright MCP 交互式完成。');
  await browser.close();
  process.exit(1);
}
