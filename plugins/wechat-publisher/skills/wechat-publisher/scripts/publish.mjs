#!/usr/bin/env node
// 把排版好的 HTML 写入微信公众号后台「草稿箱」（不群发！群发永远人工点）
// 用法: node publish.mjs <article.html> --title "标题" [--digest "摘要"] [--author "笔名"] [--cover 封面] [--img-top 文首配图] [--img-end 文末配图] [--headless]
// v2: 适配新版图文编辑器（真实剪贴板 Cmd+V 粘贴、「保存为草稿」按钮、contenteditable 标题）
// v3: 安全策略——不保存任何登录凭证（登录态不落盘），每次发布都要求管理员微信扫码
// v4: 封面上传走真实交互（封面区 → 从图片库选择），配图/封面均以「预览出现」为成功判据，不再误报
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
const probeOnly = args.includes('--probe-only');
if (!probeOnly && (!htmlFile || !fs.existsSync(htmlFile))) {
  console.error('用法: node publish.mjs <article.html> --title "标题" [--digest "摘要"] [--author "笔名"] [--cover 封面] [--img-top 文首配图] [--img-end 文末配图] [--headless]');
  process.exit(1);
}
const opt = (k) => { const i = args.indexOf('--' + k); return i > -1 ? args[i + 1] : undefined; };
const title = opt('title') || path.basename(htmlFile, '.html');
const digest = opt('digest');
const author = opt('author');
const cover = opt('cover');
const imgTop = opt('img-top');
const imgEnd = opt('img-end');
const headless = args.includes('--headless');

fs.mkdirSync(path.join(DATA, 'config'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'drafts'), { recursive: true });
const shotPath = path.join(DATA, 'drafts', `publish-${Date.now()}.png`);
const html = probeOnly ? '' : fs.readFileSync(htmlFile, 'utf8');
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
  try {
    await page.waitForSelector('.ProseMirror, #title, div[contenteditable="true"]', { state: 'visible', timeout: 30_000 });
  } catch {
    log('⚠️  直达后没找到编辑区，尝试自动点「新的创作」→「写新图文」…');
    let clicked = false;
    for (const sel of ['text=新的创作', 'button:has-text("新的创作")', '.js_create_button', '#js_create_page', 'text=写新图文']) {
      try {
        const b = page.locator(sel).first();
        if (await b.isVisible({ timeout: 1500 }).catch(() => false)) { await b.click({ timeout: 3_000 }); clicked = true; log('已点「' + sel + '」'); break; }
      } catch {}
    }
    if (!clicked) log('没找到入口，请在浏览器窗口里手动点：「新的创作」→「写新图文」（等 120 秒）…');
    try { await page.waitForURL(/appmsg|edit/, { timeout: 120_000 }); }
    catch { await die('等待进入编辑页超时'); }
  }
} else {
  log('⚠️  请在浏览器窗口里手动点：「新的创作」→「写新图文」，脚本会自动继续（等 120 秒）…');
  try { await page.waitForURL(/appmsg|edit/, { timeout: 120_000 }); }
  catch { await die('等待进入编辑页超时'); }
}
log('已进入编辑页 ✓');

// 诊断模式：只导出编辑页结构（封面区/图片工具栏），不填写不保存
if (probeOnly) {
  await dumpProbe('entry');
  await page.screenshot({ path: path.join(DATA, 'drafts', `probe-shot-${Date.now()}.png`), fullPage: true });
  log('诊断模式结束（未填写、未保存）');
  await browser.close();
  process.exit(0);
}

// 3) 填标题：新版编辑器标题框选择器不稳定，逐个候选尝试；全失败则导出诊断
const titleCandidates = [
  '#title',
  'input#title, textarea#title',
  'textarea[placeholder*="标题"]',
  'input[placeholder*="标题"]',
  'div[contenteditable="true"][data-placeholder*="标题"]',
  'div[contenteditable="true"][placeholder*="标题"]',
  '.title-input input, .title-input textarea, .title-input [contenteditable="true"]',
  'form input[type="text"]',
];
let titleOk = false;
for (const sel of titleCandidates) {
  try {
    const el = page.locator(sel).first();
    if (!(await el.isVisible({ timeout: 1500 }))) continue;
    await el.click({ timeout: 2000 });
    await page.keyboard.type(title, { delay: 15 });
    titleOk = true;
    log('标题已填 ✓（' + sel + '）');
    break;
  } catch {}
}
if (!titleOk) {
  log('⚠️  标题输入框没找到，已导出诊断，请手动填标题');
  await dumpProbe('title');
}
const titleSel = '#title, input[placeholder*="标题"], textarea[placeholder*="标题"]';

// 诊断导出：把当前编辑页的关键结构落盘，便于定位失效选择器
async function dumpProbe(tag) {
  try {
    const data = await page.evaluate(() => {
      const pick = (el) => ({
        tag: el.tagName, id: el.id, cls: (el.className || '').toString().slice(0, 80),
        ph: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
        al: el.getAttribute('aria-label') || '', title: el.getAttribute('title') || '',
        act: el.getAttribute('data-action') || '',
        accept: el.getAttribute('accept') || '',
        vis: (() => { try { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; } catch { return false; } })(),
        txt: (el.innerText || el.value || '').slice(0, 40),
      });
      const leaf = (el) => el.children.length === 0;
      return {
        url: location.href,
        inputs: [...document.querySelectorAll('input,textarea,div[contenteditable="true"],iframe')].slice(0, 20).map(pick),
        fileInputs: [...document.querySelectorAll('input[type="file"]')].map(pick),
        coverPreview: !!document.querySelector('#js_cover_area img, .js_cover_preview_new img, .select-cover__preview img'),
        coverNullPop: !!document.querySelector('.js_cover_null_pop, .js_imagedialog'),
        buttons: [...document.querySelectorAll('button,a,[title],[aria-label],[class*="edui"]')].slice(0, 60).map(pick),
        frames: [...document.querySelectorAll('iframe')].map((f) => f.src),
        // 封面区：含「封面」字样的叶子节点 + class 含 cover/upload 的元素
        coverText: [...document.querySelectorAll('*')].filter((el) => leaf(el) && /封面/.test(el.innerText || '')).slice(0, 20).map(pick),
        coverEls: [...document.querySelectorAll('[class*="cover"],[class*="upload"],[class*="js_upload"]')].slice(0, 40).map(pick),
        // 工具栏图标：edui / icon / toolbar / data-action
        icons: [...document.querySelectorAll('[class*="edui"],[class*="icon"],[class*="toolbar"],[data-action]')].slice(0, 100).map(pick),
      };
    });
    const p = path.join(DATA, 'drafts', `probe-${tag}-${Date.now()}.json`);
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
    log('诊断已导出: ' + p);
  } catch (e) { log('诊断导出失败: ' + (e.message || '').slice(0, 80)); }
}

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

// 5.5) 配图：光标定位到文首/文末，插入图片（图片插在光标处）
async function uploadImg(imgPath, atTop) {
  const where = atTop ? '文首' : '文末';
  if (!imgPath) return;
  if (!fs.existsSync(imgPath)) { log(`⚠️  ${where}配图不存在，跳过: ` + imgPath); return; }
  let before = 0;
  try { before = await page.locator('.ProseMirror img').count(); } catch {}
  const countImgs = async () => { try { return await page.locator('.ProseMirror img').count(); } catch { return before; } };
  try {
    const region = page.locator(`.ProseMirror, div[contenteditable="true"]`).filter({ hasNot: page.locator(titleSel) }).last();
    await region.click({ timeout: 8_000 });
    if (atTop) {
      await page.keyboard.press('Meta+ArrowUp');   // 文档开头
      await page.keyboard.press('Home');            // 行首
    } else {
      await page.keyboard.press('Meta+ArrowDown'); // 文档末尾
      await page.keyboard.press('Meta+ArrowRight');// 行尾
    }

    // 方案 A：工具栏「图片」按钮 + 文件选择器。
    // chooserP 先 .catch(()=>null)：否则点击失败时这个悬挂 promise 会变成 unhandled rejection 直接终止进程。
    const btnSel = 'button:has-text("图片"), [title*="图片"], [aria-label*="图片"], .edui-for-insertimage, [class*="insertimage"], [data-action*="image"]';
    if (await page.locator(btnSel).first().isVisible({ timeout: 1500 }).catch(() => false)) {
      try {
        const chooserP = page.waitForEvent('filechooser', { timeout: 12_000 }).catch(() => null);
        await page.locator(btnSel).first().click({ timeout: 8_000 });
        try { await page.locator('button:has-text("上传图片"), text=上传图片, text=点击上传').first().click({ timeout: 3_000 }); } catch {}
        const chooser = await chooserP;
        if (chooser) await chooser.setFiles(imgPath);
      } catch (e) {
        log(`（方案A图片按钮不可用: ${(e.message || '').slice(0, 60)}）`);
      }
    }
    await page.waitForTimeout(4000); // 等上传+插入
    if (await countImgs() > before) {
      await page.keyboard.press('Escape'); // 关掉可能残留的上传弹层
      log(`配图已插入 ✓（${where}）`);
      return;
    }

    // 方案 B：剪贴板写入 PNG 后 Cmd+V 粘贴（公众号 ProseMirror 支持粘贴图片，比文件选择器更稳）
    await page.keyboard.press('Escape');
    const b64 = fs.readFileSync(imgPath).toString('base64');
    await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: 'image/png' });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }, b64);
    await page.keyboard.press('Meta+V');
    await page.waitForTimeout(5000);
    if (await countImgs() > before) log(`配图已插入 ✓（${where}，剪贴板方案）`);
    else { log(`⚠️  ${where}配图未确认插入，请手动插入: ${imgPath}`); await dumpProbe('img-' + where); }
  } catch (e) {
    log(`⚠️  ${where}配图自动上传失败，请手动插入: ${imgPath}（${(e.message || '').slice(0, 80)}）`);
    await dumpProbe('img-' + where);
  }
}
await uploadImg(imgTop, true);
await uploadImg(imgEnd, false);

// 5.6) 封面上传。真实交互（实测）：点封面区 → 弹出四选项（从正文选择/从图片库选择/微信扫码上传/一键生成封面）
//      → 只有「从图片库选择」(.js_imagedialog) 能自动化：进图片库弹层 → 上传 → 选中。
//      旧版「全局 file input」会误传到正文插图框（li#js_editor_insertimage 下的隐藏 input），已移除。
//      成功判定：封面区出现预览图，否则一律报失败并导出诊断，绝不误报。
async function coverPreviewVisible() {
  try {
    return await page.locator('#js_cover_area img, .js_cover_preview_new img, .select-cover__preview img').first().isVisible({ timeout: 2000 });
  } catch { return false; }
}
async function uploadCover(cover) {
  // 已有封面（更换场景）直接跳过
  if (await coverPreviewVisible()) { log('封面已存在 ✓（未更换）'); return; }

  // 打开封面选择弹层
  let opened = false;
  for (const sel of ['.select-cover__mask', '.js_cover_btn_area', '#js_cover_area']) {
    try {
      await page.locator(sel).first().click({ timeout: 5_000 });
      await page.waitForTimeout(1500);
      if (await page.locator('.js_imagedialog').first().isVisible({ timeout: 3_000 }).catch(() => false)) { opened = true; break; }
    } catch {}
  }
  if (!opened) {
    log('⚠️  封面选择弹层没打开，请在「封面和摘要」区手动选封面');
    await dumpProbe('cover-open');
    return;
  }

  // 点「从图片库选择」，并发等文件选择框（有些版本直接弹）
  let chooser = null;
  try {
    const cp = page.waitForEvent('filechooser', { timeout: 6_000 }).catch(() => null);
    await page.locator('.js_imagedialog').first().click({ timeout: 5_000 });
    chooser = await cp;
  } catch {}
  await page.waitForTimeout(2500);

  // 图片库弹层里找「上传」入口
  if (!chooser) {
    const upSel = '.weui-desktop-dialog button:has-text("上传"), .weui-desktop-dialog a:has-text("上传"), button:has-text("上传图片"), a:has-text("本地上传"), [class*="upload"]:has-text("上传")';
    if (await page.locator(upSel).first().isVisible({ timeout: 2_000 }).catch(() => false)) {
      try {
        const cp = page.waitForEvent('filechooser', { timeout: 8_000 }).catch(() => null);
        await page.locator(upSel).first().click({ timeout: 5_000 });
        chooser = await cp;
      } catch {}
    }
  }

  // 兜底：弹层内「可见」且 accept 含 image 的 file input（排除正文插图框）
  let directInput = false;
  if (!chooser) {
    try {
      const inputs = page.locator('input[type="file"][accept*="image"]');
      const n = await inputs.count();
      for (let i = 0; i < n; i++) {
        const el = inputs.nth(i);
        const visible = await el.isVisible({ timeout: 500 }).catch(() => false);
        const inEditor = await el.evaluate((e) => !!e.closest('#js_editor_insertimage, .edui-for-insertimage')).catch(() => true);
        if (visible && !inEditor) { await el.setInputFiles(cover); directInput = true; break; }
      }
    } catch {}
  }

  if (chooser) {
    try { await chooser.setFiles(cover); } catch {}
  }
  if (chooser || directInput) {
    await page.waitForTimeout(6000);
    // 图片库上传后可能需要点「确定/选好」
    try {
      const okBtn = page.locator('.weui-desktop-dialog button:has-text("确定"), .weui-desktop-dialog button:has-text("选好"), .weui-desktop-dialog button:has-text("插入")').first();
      if (await okBtn.isVisible({ timeout: 2_000 }).catch(() => false)) await okBtn.click({ timeout: 3_000 });
    } catch {}
    await page.waitForTimeout(3000);
    await page.keyboard.press('Escape');
    if (await coverPreviewVisible()) { log('封面已上传 ✓（图片库）'); return; }
    log('⚠️  图片库上传后未看到封面预览');
    await dumpProbe('cover-imglib');
    return;
  }

  log('⚠️  封面自动上传失败（图片库入口未找到），请在「封面和摘要」区手动选封面');
  await dumpProbe('cover');
}

// 6) 摘要（新版在「设置」里，先试常见输入框）
if (digest) {
  const digestBox = page.locator('#digest, textarea[placeholder*="摘要"], textarea[placeholder*="选填"]').first();
  try { await digestBox.fill(digest, { timeout: 8_000 }); log('摘要已填 ✓'); } catch { log('（摘要输入框未找到，可在保存弹窗里填）'); }
}

// 7) 封面（可选，必须在保存草稿之前完成）
if (cover && fs.existsSync(cover)) await uploadCover(cover);

// 8) 保存为草稿（新版按钮文案）
const saveBtn = page.locator('button:has-text("保存为草稿"), [role="button"]:has-text("保存为草稿"), button:has-text("保存"):not(:has-text("群发"))').first();
try {
  await saveBtn.click({ timeout: 10_000 });
  await page.waitForTimeout(3000);
  log('已点击「保存为草稿」✓');
} catch { log('⚠️  保存按钮没点到，请手动点「保存为草稿」'); }

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
