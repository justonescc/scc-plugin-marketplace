#!/usr/bin/env node
// Markdown → 微信公众号内联样式 HTML
// 用法: node md2wx.mjs <input.md> [output.html]
// 支持文件头 frontmatter（title/digest），正文参与转换，frontmatter 不输出。
import fs from 'node:fs';
import { marked } from 'marked';

const [, , inFile, outFileArg] = process.argv;
if (!inFile || !fs.existsSync(inFile)) {
  console.error('用法: node md2wx.mjs <input.md> [output.html]');
  process.exit(1);
}

const raw = fs.readFileSync(inFile, 'utf8');
let body = raw;
const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
if (fm) body = raw.slice(fm[0].length);

const html = marked.parse(body);

// 公众号只认内联 style；样式对齐常见图文规范：15px 正文、宽松行距、主题绿 #07c160
const STYLE = {
  p: 'font-size:15px;color:#333;line-height:1.9;letter-spacing:0.5px;margin:16px 8px;text-align:justify;',
  h1: 'font-size:19px;font-weight:bold;color:#111;line-height:1.6;margin:28px 8px 16px;',
  h2: 'font-size:17px;font-weight:bold;color:#111;line-height:1.6;margin:26px 8px 14px;padding-left:10px;border-left:4px solid #07c160;',
  h3: 'font-size:15px;font-weight:bold;color:#222;margin:20px 8px 10px;',
  ul: 'margin:12px 8px;padding-left:22px;',
  ol: 'margin:12px 8px;padding-left:22px;',
  li: 'font-size:15px;color:#333;line-height:1.9;margin:6px 0;',
  blockquote: 'margin:16px 8px;padding:12px 14px;background:#f7f7f7;border-left:4px solid #07c160;color:#555;',
  pre: 'background:#f6f8fa;padding:12px;border-radius:4px;overflow-x:auto;font-size:13px;line-height:1.6;',
  code: 'background:#f2f2f2;padding:2px 5px;border-radius:3px;font-size:13px;',
  img: 'max-width:100%;border-radius:4px;display:block;margin:16px auto;',
  a: 'color:#576b95;',
  hr: 'border:none;border-top:1px solid #ddd;margin:24px 8px;',
  table: 'border-collapse:collapse;margin:16px auto;font-size:13px;',
  th: 'border:1px solid #ddd;padding:6px 10px;background:#f7f7f7;',
  td: 'border:1px solid #ddd;padding:6px 10px;',
};

let out = html;
for (const [tag, style] of Object.entries(STYLE)) {
  out = out.replace(new RegExp(`<${tag}(\\s|>)`, 'g'), `<${tag} style="${style}"$1`);
}

const outPath = outFileArg || inFile.replace(/\.md$/i, '.html');
fs.writeFileSync(outPath, out);
console.log(`已生成: ${outPath}`);
