// 违禁词自检：草稿正文逐词比对 banned_words.txt + profile.yaml 的 banned_extra
// 用法: node check-banned.mjs <draft.md>
// 命中输出词+行号+行内容，exit 1；全部通过 exit 0。
// 说明：只做检测不改写——按 SKILL.md 约定，命中一律由写作方改写为合规表述（意思不变），不机械删除。
import fs from 'node:fs';
import path from 'node:path';

const SKILL = path.dirname(new URL(import.meta.url).pathname); // $SKILL/scripts
const ROOT = path.dirname(SKILL);                              // $SKILL
const [draftArg] = process.argv.slice(2);
if (!draftArg) { console.error('用法: node check-banned.mjs <draft.md>'); process.exit(1); }
const draftPath = path.resolve(draftArg);
if (!fs.existsSync(draftPath)) { console.error('草稿不存在: ' + draftPath); process.exit(1); }

// 词库：通用违禁词 + 账号专属 banned_extra（profile.yaml 里的简单 YAML 列表）
const readWords = (file) => fs.readFileSync(file, 'utf8')
  .split('\n').map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
const words = readWords(path.join(ROOT, 'config/banned_words.txt'));
try {
  const profile = fs.readFileSync(path.join(process.env.HOME, '.wechat-publisher/config/profile.yaml'), 'utf8');
  const m = profile.match(/^banned_extra:\s*\n((?:\s*-\s*.+\n?)+)/m);
  if (m) for (const line of m[1].split('\n')) {
    const w = line.replace(/^\s*-\s*/, '').trim();
    if (w) words.push(w);
  }
} catch {}

// 正文：跳过 frontmatter（--- 包围的头块），正文里再逐行找
const raw = fs.readFileSync(draftPath, 'utf8');
const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');

let hits = 0;
body.split('\n').forEach((line, i) => {
  for (const w of words) {
    if (w && line.includes(w)) {
      hits++;
      console.log(`✗ [${w}] 第 ${i + 1} 行: ${line.trim().slice(0, 60)}`);
    }
  }
});

if (hits) { console.log(`\n共 ${hits} 处命中，改写为合规表述后再排版。`); process.exit(1); }
console.log(`违禁词自检通过 ✓（比对 ${words.length} 个词，含账号专属 banned_extra）`);
