// 垃圾文件自动清理：发布截图 / probe 诊断 / 续编 url / 一次性截图脚本 / 过时软链
// CLI 用法: node cleanup.mjs [--keep 5] [--dry-run]
// 供 publish.mjs 保存成功后 import 调用 runCleanup({keep})（失败不阻断发布收尾）。
// 正式产物永不碰：drafts/*.md|*.html、metrics.md、cards/*.html、cards/*.png（封面卡/信息卡是账号资产）。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DATA = path.join(process.env.HOME, '.wechat-publisher');
const DRAFTS = path.join(DATA, 'drafts');
const CARDS = path.join(DRAFTS, 'cards');

function listMatching(dir, test) {
  try {
    return fs.readdirSync(dir).filter((f) => test(f)).map((f) => path.join(dir, f));
  } catch { return []; }
}
const byMtimeDesc = (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
function keepLatestN(files, n) {
  if (files.length <= n) return [];
  return [...files].sort(byMtimeDesc).slice(n); // 保留最新 n 个，返回要删的
}

// 收集垃圾清单（发布截图/probe 诊断保留最新 keep 个，其余全删）
function collectTargets(keep) {
  const targets = [];
  targets.push(...keepLatestN(listMatching(DRAFTS, (f) => /^publish-\d+\.png$/.test(f)), keep));
  targets.push(...keepLatestN(listMatching(DRAFTS, (f) => /^(probe|cover-probe)-.+\.(json|png)$/.test(f)), keep));
  targets.push(...listMatching(DRAFTS, (f) => /^publish-\d+-url\.txt$/.test(f)));      // 续编 URL，发布成功即失效
  targets.push(...listMatching(DRAFTS, (f) => /^(probe|cover-probe)\d*\.mjs$/.test(f))); // 历史调试脚本
  // cards 一次性截图脚本（已被 $SKILL/scripts/shot.mjs 取代，含旧版 shot.mjs）、过时软链
  targets.push(...listMatching(CARDS, (f) => /^shot[\w.-]*\.(js|mjs)$/.test(f)));
  try {
    if (fs.lstatSync(path.join(CARDS, 'node_modules')).isSymbolicLink()) targets.push(path.join(CARDS, 'node_modules'));
  } catch {}
  return targets;
}

// 静默版：返回删除数，供 publish.mjs 自动调用
export function runCleanup({ keep = 5 } = {}) {
  let n = 0;
  for (const p of collectTargets(keep)) { try { fs.rmSync(p, { force: true }); n++; } catch {} }
  return n;
}

// CLI 直跑入口（被 import 时 process.argv[1] 是 publish.mjs，不等于本文件，跳过）
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : undefined; };
  const keep = Number(opt('--keep')) || 5;
  const dry = argv.includes('--dry-run');
  const targets = collectTargets(keep);
  let removed = 0, failed = 0;
  for (const p of targets) {
    if (dry) { console.log('[将删]', p); removed++; continue; }
    try { fs.rmSync(p, { force: true }); removed++; } catch (e) { failed++; console.error('[失败]', p, e.message); }
  }
  const tag = dry ? '（dry-run 预览）' : '';
  console.log(`清理完成${tag}: 删 ${removed} 个${failed ? `，失败 ${failed} 个` : ''}（发布截图/probe 诊断各保留最新 ${keep} 个）`);
  process.exit(failed ? 1 : 0);
}
