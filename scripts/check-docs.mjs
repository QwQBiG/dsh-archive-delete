import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function markdownFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await markdownFiles(join(directory, entry.name), name));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(name);
  }
  return files;
}
function fencedBlocks(source, name) {
  const blocks = []; let opening; let body = [];
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!opening && fence) { opening = { marker: fence[1][0], length: fence[1].length, info: fence[2].trim() }; body = []; }
    else if (opening && fence && fence[1][0] === opening.marker && fence[1].length >= opening.length && fence[2].trim() === '') {
      blocks.push({ language: opening.info, text: body.join('\n') }); opening = undefined;
    } else if (opening) body.push(line);
  }
  if (opening) throw new Error(`Unclosed code fence / 代码围栏未闭合: ${name}`);
  return blocks;
}
function prose(source) {
  return source.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm, '');
}
async function checkLinks(source, name) {
  const targets = []; let checked = 0;
  const content = prose(source);
  // Inline links/images support angle-bracket destinations, balanced parentheses,
  // and an optional quoted title. Reference definitions cover [label][reference].
  const inline = /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|((?:[^\s()\\]|\\.|\([^()]*\))+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^\n]*\)))?\s*\)/g;
  for (const match of content.matchAll(inline)) targets.push(match[1] ?? match[2]);
  for (const match of content.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm)) targets.push(match[1] ?? match[2]);
  for (const target of targets) {
    if (!target || target.startsWith('#') || target.startsWith('//') || /^[A-Za-z][\w+.-]*:/.test(target) || isAbsolute(target)) continue;
    const pathPart = target.split(/[?#]/, 1)[0]; if (!pathPart) continue;
    let decoded;
    try { decoded = decodeURIComponent(pathPart.replace(/\\([()\[\] ])/g, '$1')); }
    catch { throw new Error(`Invalid link encoding / 链接编码无效: ${name} → ${target}`); }
    try { await access(resolve(root, dirname(name), decoded)); checked++; }
    catch { throw new Error(`Broken relative link / 相对链接失效: ${name} → ${target}`); }
  }
  return checked;
}
function versions(source) {
  return [...new Set(source.match(/\bv?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/g) ?? [])].sort();
}

const rootNames = (await readdir(root)).filter(name => name.endsWith('.md'));
const all = new Set([...rootNames, ...await markdownFiles(join(root, 'docs'), 'docs')]);
const pairedName = name => name.endsWith('.zh-CN.md') ? name.replace(/\.zh-CN\.md$/, '.md') : name.replace(/\.md$/, '.zh-CN.md');
for (const name of all) {
  const pair = pairedName(name);
  if (!all.has(pair)) throw new Error(`Missing paired document / 缺少对应语言文档: ${pair}`);
}
const sources = new Map(); let links = 0;
for (const name of [...all].sort()) {
  const pair = pairedName(name);
  const source = await readFile(join(root, name), 'utf8'); sources.set(name, source);
  const languageTarget = pair.split('/').at(-1);
  if (!source.includes(`](${languageTarget})`)) throw new Error(`Missing language link / 缺少语言互链: ${name}`);
  if (/TODO|TBD|待补充|待完善/.test(source)) throw new Error(`Unfinished document / 文档尚未完成: ${name}`);
  links += await checkLinks(source, name);
}
const english = [...all].filter(name => !name.endsWith('.zh-CN.md'));
const chinese = [...all].filter(name => name.endsWith('.zh-CN.md'));
if (english.length !== chinese.length || all.size !== english.length * 2) throw new Error('Document pair counts differ / 双语文档数量不一致');
for (const name of english) {
  const pair = name.replace(/\.md$/, '.zh-CN.md');
  const left = sources.get(name); const right = sources.get(pair);
  if (JSON.stringify(fencedBlocks(left, name)) !== JSON.stringify(fencedBlocks(right, pair)))
    throw new Error(`Bilingual code blocks differ / 双语代码块不一致: ${name} ↔ ${pair}`);
  if (JSON.stringify(versions(left)) !== JSON.stringify(versions(right)))
    throw new Error(`Bilingual version references differ / 双语版本引用不一致: ${name} ↔ ${pair}`);
}
console.log(`Checked ${english.length} document pairs, ${links} relative links, matching code blocks and versions / 已检查 ${english.length} 组双语文档、${links} 个相对链接及一致的代码块与版本`);
