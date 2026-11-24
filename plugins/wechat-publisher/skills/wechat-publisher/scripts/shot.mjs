// 通用卡片截图：把 HTML 卡片截成 PNG（deviceScaleFactor 2 保证清晰度）
// 用法: node shot.mjs <card.html> <out.png> [w=900] [h=383]
//       路径可为相对 $WP_DATA/drafts/cards/ 的文件名或绝对路径。
// 本地只有完整版 chromium-1223（无 headless-shell），必须 executablePath 指定。
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const CARDS = path.join(process.env.HOME, '.wechat-publisher/drafts/cards');
const EXEC = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const [htmlArg, pngArg, w, h] = process.argv.slice(2);
if (!htmlArg || !pngArg) {
  console.error('用法: node shot.mjs <card.html> <out.png> [w=900] [h=383]');
  process.exit(1);
}
const resolve = (p) => (path.isAbsolute(p) ? p : path.join(CARDS, p));
const htmlPath = resolve(htmlArg);
const pngPath = resolve(pngArg);
if (!fs.existsSync(htmlPath)) { console.error('HTML 不存在: ' + htmlPath); process.exit(1); }

const width = Number(w) || 900;
const height = Number(h) || 383;

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
await page.goto(`file://${htmlPath}`);
await page.waitForTimeout(400);
await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width, height } });
await browser.close();
console.log('shot ✓', pngPath, `(${width * 2}x${height * 2} @2x)`);
