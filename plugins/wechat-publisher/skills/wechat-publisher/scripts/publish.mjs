#!/usr/bin/env node
// 把排版好的 HTML 写入微信公众号后台「草稿箱」（不群发！群发永远人工点）
// 用法: node publish.mjs <article.html> --title "标题" [--digest "摘要"] [--author "笔名"] [--cover 封面] [--img-top 文首配图] [--img-end 文末配图] [--original 原创作者名] [--ai-source] [--headless]
// v2: 适配新版图文编辑器（真实剪贴板 Cmd+V 粘贴、「保存为草稿」按钮、contenteditable 标题）
// v3: 安全策略——不保存任何登录凭证（登录态不落盘），每次发布都要求管理员微信扫码
// v4: 封面上传走真实交互（封面区 → 从图片库选择），配图/封面均以「预览出现」为成功判据，不再误报
// v5: 修复封面自动上传（WebUploader 动态 label 拦截真实点击 → 程序化 file input click；
//     js_imagedialog 多实例取浮层内可见者；上传完成判据=图片列表项数量增加；选图→下一步→裁剪确认）
// v6: 新增 --original（文字原创声明）与 --ai-source（创作来源标「内容由AI生成」）；
//     原创作者栏 js_counter 校验依赖 keydown/keyup+blur 事件链，fill 类 API 不触发（2026-11-24 实测）
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
const originalAuthor = opt('original'); // 传了就声明文字原创，作者名≤8字
const aiSource = args.includes('--ai-source'); // 创作来源标「内容由AI生成」
const headless = args.includes('--headless');
// v6.5: --resume <url|url文件路径> 直达已有草稿续编（上次失败 die 存的 -url.txt）。
//       续编幂等：正文/标题/摘要/封面/原创/AI来源已设置的部分自动跳过，不会重复插图（不传 --img-* 即可）。
const resumeArg = opt('resume');
let resumeUrl = resumeArg || null;
if (resumeUrl && !/^https?:/.test(resumeUrl) && fs.existsSync(resumeUrl)) {
  resumeUrl = fs.readFileSync(resumeUrl, 'utf8').trim().split('\n')[0] || null; // 支持 --resume xxx-url.txt
}
if (resumeUrl && !/^https?:/.test(resumeUrl)) resumeUrl = null;

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
// v6.5: --resume 续编直达——先扫码恢复登录态，再直接打开上次失败时存下的草稿编辑 URL
let token = resumeUrl ? '' : await page.evaluate(() => {
  try {
    const w = window.wx?.commonData;
    return w?.data?.t || w?.token || new URLSearchParams(location.search).get('token') || '';
  } catch { return ''; }
});
if (resumeUrl) {
  log('续编模式：直达已有草稿 ' + resumeUrl.slice(0, 80) + '…');
  await page.goto(resumeUrl, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('.ProseMirror, #title, div[contenteditable="true"]', { state: 'visible', timeout: 30_000 });
    log('已进入续编草稿 ✓');
  } catch { await die('续编直达后没找到编辑区（URL 可能已过期，去掉 --resume 直接重跑）'); }
} else if (token) {
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
    if (!clicked) {
      // v6.4: 连续两次发布都要人工点入口——导出首页结构供离线分析，修选择器不用再等下次踩坑
      log('没找到入口，请在浏览器窗口里手动点：「新的创作」→「写新图文」（等 120 秒）…');
      await dumpProbe('entry');
    }
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
// v6.5: 续编幂等——标题已有内容则跳过，避免重跑时叠在旧标题后面
const titleFilled = resumeUrl ? await page.evaluate(() => {
  const el = document.querySelector('#title, div[contenteditable="true"][data-placeholder*="标题"], input[placeholder*="标题"]');
  return !!el && (el.textContent || el.value || '').trim().length > 0;
}) : false;
if (titleFilled) {
  titleOk = true;
  log('标题已存在 ✓（续编跳过）');
} else for (const sel of titleCandidates) {
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
  // v6.5: 固定等 2.5s 改为轮询——渲染完成即返回，通常 <1s
  let ok = false;
  for (let i = 0; i < 13 && !ok; i++) { ok = await contentContains(probe); if (!ok) await page.waitForTimeout(200); }
  if (ok) log(`正文已粘贴 ✓（经 ${label}）`);
  return ok;
}
async function contentContains(text) {
  // v6.1: 页面渲染文本带空格（如「让 AI 帮你写…」），probe 已去空白，
  // 直接 includes/getByText 永远不匹配 → 粘贴成功也被误判失败。
  // 改为对页面文本做同样的空白归一化后再比对。
  for (const frame of [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame())]) {
    try {
      const ok = await frame.evaluate(
        (t) => ((document.body && document.body.innerText) || '').replace(/\s+/g, '').includes(t),
        text
      );
      if (ok) return true;
    } catch {}
  }
  return false;
}
let pasted = false;
// v6.5: 续编幂等——正文已含本文开头则跳过粘贴，避免重跑时全文叠两遍
if (resumeUrl && probe && (await contentContains(probe))) {
  pasted = true;
  log('正文已存在 ✓（续编跳过粘贴）');
}
if (!pasted) try {
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
    await page.waitForFunction(
      (t) => document.body.innerText.replace(/\s+/g, '').includes(t),
      probe,
      { timeout: 180_000 }
    );
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
    // v6.5: 固定等 4s 改为轮询图片数量——插入完成即返回（最多 4s）
    let inserted = false;
    for (let i = 0; i < 8 && !inserted; i++) { inserted = (await countImgs()) > before; if (!inserted) await page.waitForTimeout(500); }
    if (inserted) {
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
    // v6.5: 固定等 5s 改为轮询（最多 5s）
    let pasted2 = false;
    for (let i = 0; i < 10 && !pasted2; i++) { pasted2 = (await countImgs()) > before; if (!pasted2) await page.waitForTimeout(500); }
    if (pasted2) log(`配图已插入 ✓（${where}，剪贴板方案）`);
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

  // v5: 打开封面选择浮层。注意 .js_imagedialog 在正文插图菜单里有同名元素，
  //     必须判断浮层上下文里 offsetParent 非空的实例，否则会误判「弹层没打开」。
  let opened = false;
  for (const sel of ['#js_cover_area', '.js_cover_btn_area', '.select-cover__mask']) {
    try {
      await page.locator(sel).first().click({ timeout: 5_000 });
      // v6.5: 固定等 1.5s 改为轮询弹层出现（200ms×8，出现即走）
      for (let i = 0; i < 8 && !opened; i++) {
        await page.waitForTimeout(200);
        opened = await page.evaluate(() =>
          [...document.querySelectorAll('a.pop-opr__button.js_imagedialog')].some((a) => a.offsetParent !== null)
        );
      }
      if (opened) break;
    } catch {}
  }
  if (!opened) {
    log('⚠️  封面选择弹层没打开，请在「封面和摘要」区手动选封面');
    await dumpProbe('cover-open');
    return;
  }

  // 进图片库弹层（点浮层里可见的那个「从图片库选择」）
  await page.evaluate(() => {
    const a = [...document.querySelectorAll('a.pop-opr__button.js_imagedialog')].find((x) => x.offsetParent !== null);
    if (a) a.click();
  });
  const imgDlgReady = await page
    .waitForSelector('.weui-desktop-dialog:has-text("选择图片")', { state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!imgDlgReady) {
    log('⚠️  图片库弹层没打开，请手动选封面');
    await dumpProbe('cover-imglib-open');
    return;
  }

  // 记录上传前的图片列表项数量与 src 集合：数量变化判断上传完成，src 差集找出新图（防选错旧图）
  const countBefore = await page.evaluate(() => document.querySelectorAll('.weui-desktop-img-picker__item').length);
  const srcsBefore = await page.evaluate(() =>
    [...document.querySelectorAll('.weui-desktop-img-picker__item img')].map((i) => i.getAttribute('src'))
  );

  // v5 关键修复：WebUploader 会动态生成 <label> 盖住「上传文件」按钮，任何真实点击都会报
  //     "intercepts pointer events" 并无限重试。绕过方式：程序化 click 它包裹的 file input
  //     （accept 含 image/png、藏在 div[id^=rt_rt_] 里的那个）来触发 filechooser。
  // v6.2 修复：必须排除正文插图框（li#js_editor_insertimage）下的 file input——
  //     盲取 inputs[length-1] 会命中它，把封面图直接插进正文（v6.2 实测踩坑）。
  //     注意 waitForEvent 必须先注册再触发 click，否则 filechooser 事件会漏掉（竞态）。
  const chooserP = page.waitForEvent('filechooser', { timeout: 10_000 }).catch(() => null);
  const triggered = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    const inEditor = (i) => !!i.closest('#js_editor_insertimage');
    const t = inputs.find((i) => (i.accept || '').includes('image/png') && !inEditor(i))
           || [...inputs].reverse().find((i) => !inEditor(i));
    if (!t) return false;
    t.click();
    return true;
  });
  const chooser = triggered ? await chooserP : null;

  if (chooser) {
    await chooser.setFiles(cover).catch(() => {});
  } else {
    // 兜底：setInputFiles 不依赖 filechooser 事件（input 视觉隐藏也能设值），同样排除正文插图框
    try {
      await page.locator('input[type="file"][accept*="image/png"]')
        .filter({ hasNot: page.locator('#js_editor_insertimage') }).last()
        .setInputFiles(cover, { timeout: 5_000 });
    } catch {}
  }

  // 等上传完成：图片列表项数量增加（最长 20s，图片库上传含 CDN 往返）
  let uploaded = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const n = await page.evaluate(() => document.querySelectorAll('.weui-desktop-img-picker__item').length);
    if (n > countBefore) { uploaded = true; break; }
  }
  if (!uploaded) {
    log('⚠️  封面图片上传超时，请手动选封面');
    await dumpProbe('cover-upload');
    return;
  }
  log('封面图片已上传到图片库 ✓');

  // v6.2 修复：选中「刚上传的那张」——按上传前后 src 差集找新图，文件名匹配仅作兜底。
  //     旧逻辑 fallback 盲选列表第一项，图片库里有历史图时会选中旧图
  //     （v6.2 实测：封面被选成上一篇的旧封面卡）。认不出新图就报失败，绝不盲选。
  const fname = path.basename(cover);
  let newSrc = '';
  const picked = await page.evaluate(({ name, befores }) => {
    const items = [...document.querySelectorAll('.weui-desktop-img-picker__item')].filter((i) => i.offsetParent !== null);
    const isNew = (i) => {
      const img = i.querySelector('img');
      return img && !befores.includes(img.getAttribute('src'));
    };
    const hit = items.find(isNew) || items.find((i) => i.textContent.includes(name));
    if (!hit) return null;
    (hit.querySelector('img') || hit).click();
    const img = hit.querySelector('img');
    return img ? img.getAttribute('src') : '';
  }, { name: fname, befores: srcsBefore });
  if (!picked) {
    log('⚠️  图片库里没认出刚上传的封面（为防选错图已放弃盲选），请手动选封面');
    await dumpProbe('cover-pick');
    return;
  }
  newSrc = picked;
  await page.waitForTimeout(400); // 选中态是同步 class 切换，短等即可
  const nextBtn = page.locator('.weui-desktop-dialog button:has-text("下一步")').first();
  if (await nextBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await nextBtn.click({ timeout: 5_000 });
    // v6.5: 删掉固定等 1.5s——下方 confirmBtn.waitFor(visible) 本身就是条件等待，重复等待
  }

  // 裁剪确认（弹层切到「编辑封面」，底部「确认」；默认裁剪框即全图，直接确认）
  const confirmBtn = page.locator('button:has-text("确认")').first();
  try {
    await confirmBtn.waitFor({ state: 'visible', timeout: 8_000 });
    await confirmBtn.click({ timeout: 5_000 });
  } catch {}

  // 成功判定：封面预览图出现，或封面区出现「修改/换一张」（已设封面态）
  // v6.2: 预览出现还不够——再比对预览 src 与刚上传图的 src 前缀，选错旧图时告警而非静默成功
  // v6.5: 固定等 3s 改为轮询——预览出现即返回（最多 3s）
  let ok = false;
  for (let i = 0; i < 10 && !ok; i++) {
    ok = (await coverPreviewVisible()) ||
      (await page.evaluate(() => (((document.querySelector('#js_cover_area') || {}).textContent || '')).includes('换一张')));
    if (!ok) await page.waitForTimeout(300);
  }
  if (ok) {
    const coverSrc = await page.evaluate(() => {
      const img = document.querySelector('#js_cover_area img, .js_cover_preview_new img, .select-cover__preview img');
      return img ? img.getAttribute('src') : '';
    });
    const base = (u) => (u || '').split('?')[0];
    if (coverSrc && newSrc && base(coverSrc) !== base(newSrc)) {
      log(`⚠️  封面预览与刚上传的图不一致（可能选了旧图），请人工核对封面！预览=${base(coverSrc)} 新图=${base(newSrc)}`);
    } else {
      log('封面已上传 ✓（图片库→裁剪确认）');
    }
    return;
  }
  log('⚠️  图片库上传后未看到封面预览');
  await dumpProbe('cover-imglib');
}

// 6) 摘要（新版在「设置」里，先试常见输入框）
if (digest) {
  const digestBox = page.locator('#digest, textarea[placeholder*="摘要"], textarea[placeholder*="选填"]').first();
  // v6.5: 续编幂等——已有非空摘要则跳过；顺带回读校验（v6.5 发布时摘要预览计数显示 0/120，存疑待验证）
  let skip = false;
  if (resumeUrl) {
    const cur = await digestBox.inputValue({ timeout: 3_000 }).catch(() => '');
    skip = !!cur.trim();
    if (skip) log('摘要已存在 ✓（续编跳过）');
  }
  if (!skip) {
    try {
      await digestBox.fill(digest, { timeout: 8_000 });
      const back = await digestBox.inputValue({ timeout: 2_000 }).catch(() => '');
      if (back.trim() === digest.trim()) log('摘要已填 ✓（回读一致）');
      else log('摘要已填 ✓（回读不一致，后台留意）');
    } catch { log('（摘要输入框未找到，可在保存弹窗里填）'); }
  }
}

// 6.5) 原创声明（--original "作者名"）：设置区「未声明」→ 文字原创 + 作者 + 勾协议 + 确定。
//      作者栏 class 含 js_counter，其校验 state 只认 keydown/keyup+blur 事件链——
//      fill/pressSequentially 后计数器仍是 0/8、确定会报「作者不能为空」（v6 实测坑）。
async function declareOriginal(authorName) {
  const undeclared = page.locator('text=未声明').first();
  if (!(await undeclared.isVisible({ timeout: 5_000 }).catch(() => false))) {
    log('原创：入口未见「未声明」（可能已声明），跳过');
    return;
  }
  await undeclared.click({ timeout: 5_000 });
  // v6.5: 固定等 1.5s 改为轮询弹层 checkbox 出现（200ms×8）
  for (let i = 0; i < 8; i++) {
    const cbVisible = await page.evaluate(() =>
      [...document.querySelectorAll('input[type=checkbox]')].some((c) => c.offsetParent !== null)
    );
    if (cbVisible) break;
    await page.waitForTimeout(200);
  }
  // 勾「我已阅读并同意《微信公众平台原创声明及相关功能使用协议》」
  await page.evaluate(() => {
    const cbs = [...document.querySelectorAll('input[type=checkbox]')].filter((c) => c.offsetParent !== null);
    const cb = cbs.find((c) => { const box = c.closest('div, p, label, td'); return box && /原创声明及相关功能使用协议/.test(box.textContent || ''); }) || cbs[0];
    if (cb && !cb.checked) cb.click();
  });
  await page.waitForTimeout(300); // v6.5: 500→300，同步勾选状态
  // 作者栏（≤8字），填完补事件链让校验 state 生效
  const inp = page.locator('#js_original_edit_box input[placeholder="请输入作者"]');
  try {
    await inp.click({ timeout: 5_000 });
    await inp.pressSequentially(authorName.slice(0, 8), { timeout: 15_000 });
    await inp.evaluate((e) => {
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
      e.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 229 }));
      e.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, keyCode: 229 }));
      e.blur();
    });
  } catch { log('⚠️  原创作者栏填写失败，请后台手动补'); }
  await page.waitForTimeout(300); // v6.5: 500→300
  // 「确定」可能触发协议确认层，循环点两次
  for (let i = 0; i < 2; i++) {
    const ok = page.locator('button:has-text("确定")').first();
    if (await ok.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await ok.click({ timeout: 3_000 }).catch(() => {});
      await page.waitForTimeout(500); // v6.5: 1500→500，下一轮 isVisible(3s) 自带等待兜底
    }
  }
  const done = await page.evaluate(() => /已声明|已开启快捷转载/.test(document.body.textContent));
  if (done) log('原创声明 ✓（文字原创 · ' + authorName.slice(0, 8) + '）');
  else { log('⚠️  原创声明状态未确认，请后台检查'); await dumpProbe('original'); }
}

// 6.6) 创作来源（--ai-source）：标「内容由AI生成」。v6 实测：radio 选中后必须点弹层内
//      「确认」保存，Escape/外点会丢选择；「未添加」行定位用「创作来源」文本上溯，不数序号。
// v6.3 修复：行定位不能要求叶子元素（children.length === 0）——「创作来源」旁带 tooltip
//      问号图标（svg/i 子元素），叶子判据必失败，报「没找到创作来源设置行」但行明明可见。
//      改为「文本以『创作来源』开头且可见」的元素中取文本最短者（最小元素），再上溯设置行。
function aiSourceRowLocateExpr() {
  return `
    (function () {
      const cands = [...document.querySelectorAll('*')].filter((e) =>
        e.offsetParent !== null && /^创作来源/.test((e.textContent || '').trim())
      );
      if (!cands.length) return null;
      const label = cands.sort((a, b) => a.textContent.length - b.textContent.length)[0];
      return label.closest('[class*="item"], [class*="row"], [class*="setting"], td') || label.parentElement.parentElement;
    })()
  `;
}
async function declareAiSource() {
  // v6.5: 幂等——已标「内容由AI生成」的（--resume 续编场景）直接跳过，不再点开弹层
  const already = await page.evaluate(new Function(`
    const row = (${aiSourceRowLocateExpr()});
    return !!row && /内容由AI生成/.test(row.textContent || '');
  `));
  if (already) { log('创作来源已是「内容由AI生成」✓（跳过）'); return; }
  const opened = await page.evaluate(new Function(`
    const row = (${aiSourceRowLocateExpr()});
    if (!row) return false;
    const target = [...row.querySelectorAll('*')].reverse().find((e) => e.offsetParent !== null && /未添加|未设置/.test((e.textContent || '').trim()) && e.children.length <= 2) || row;
    target.click();
    return true;
  `));
  if (!opened) { log('⚠️  没找到创作来源设置行'); return; }
  // v6.5: 固定等 1.5s 改为轮询选项出现（200ms×10）
  let optVisible = false;
  for (let i = 0; i < 10 && !optVisible; i++) {
    optVisible = await page.locator('text=内容由AI生成').first().isVisible({ timeout: 200 }).catch(() => false);
    if (!optVisible) await page.waitForTimeout(200);
  }
  try {
    await page.locator('text=内容由AI生成').click({ timeout: 8_000 });
  } catch { log('⚠️  「内容由AI生成」选项没找到'); return; }
  await page.waitForTimeout(300); // v6.5: 500→300
  const ok = page.locator('button:has-text("确认")').first();
  if (await ok.isVisible({ timeout: 5_000 }).catch(() => false)) await ok.click({ timeout: 5_000 }).catch(() => {});
  // v6.5: 固定等 1.5s 改为轮询保存状态（300ms×5）
  let saved = false;
  for (let i = 0; i < 5 && !saved; i++) {
    saved = await page.evaluate(new Function(`
      const row = (${aiSourceRowLocateExpr()});
      return !!row && /内容由AI生成/.test(row.textContent || '');
    `));
    if (!saved) await page.waitForTimeout(300);
  }
  if (saved) log('创作来源 ✓（内容由AI生成）');
  else { log('⚠️  创作来源保存状态未确认，请后台检查'); await dumpProbe('ai-source'); }
}

if (originalAuthor) await declareOriginal(originalAuthor);
if (aiSource) await declareAiSource();

// 7) 封面（可选，必须在保存草稿之前完成）
if (cover && fs.existsSync(cover)) await uploadCover(cover);

// 8) 保存为草稿（新版按钮文案）
const saveBtn = page.locator('button:has-text("保存为草稿"), [role="button"]:has-text("保存为草稿"), button:has-text("保存"):not(:has-text("群发"))').first();
try {
  await saveBtn.click({ timeout: 10_000 });
  log('已点击「保存为草稿」✓');
} catch { log('⚠️  保存按钮没点到，请手动点「保存为草稿」'); }

// 9) 等保存完成（宽松等待，期间用户可手动补封面/摘要）
// v6.5: 删掉点击后固定等 3s——下方 waitForFunction 本身就是条件等待，重复等待
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
// v6.5: 发布成功后自动清理垃圾（旧发布截图/过期probe诊断/续编url/一次性截图脚本），失败不影响本次结果
try {
  const { runCleanup } = await import('./cleanup.mjs');
  const removed = runCleanup({ keep: 5 });
  log('垃圾清理 ✓（' + removed + ' 个旧文件）');
} catch {}
process.exit(0);

async function die(msg) {
  await page.screenshot({ path: shotPath }).catch(() => {});
  log('❌ ' + msg + '，截图: ' + shotPath);
  // v6.4: 失败时导出当前编辑页 URL（含 draft id 的话可用于续编，不必从零重跑），
  //       并提示草稿箱残留——公众号编辑器会自动保存，失败重跑成功后记得删同名旧草稿。
  try {
    const url = page.url();
    fs.writeFileSync(shotPath.replace(/\.png$/, '-url.txt'), url);
    log('当前编辑页 URL 已存: ' + shotPath.replace(/\.png$/, '-url.txt') + '（含 draft id 可续编）');
  } catch {}
  log('注意：编辑器会自动保存，本次不完整草稿可能已在草稿箱——重跑成功后删除同名旧草稿，避免重复。');
  log('兜底方案：剪贴板里已有排版 HTML，人工打开后台粘贴发布；或改用 playwright MCP 交互式完成。');
  await browser.close();
  process.exit(1);
}
