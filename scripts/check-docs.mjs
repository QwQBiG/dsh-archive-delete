import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = new URL('../', import.meta.url).pathname;
const rootNames = (await readdir(root)).filter(n => n.endsWith('.md'));
const docsNames = (await readdir(join(root, 'docs'))).filter(n => n.endsWith('.md')).map(n => `docs/${n}`);
const all = new Set([...rootNames, ...docsNames]);
for (const name of all) {
  const pair = name.endsWith('.zh-CN.md') ? name.replace('.zh-CN.md', '.md') : name.replace('.md', '.zh-CN.md');
  if (!all.has(pair)) throw new Error(`Missing paired document: ${pair}`);
  const text = await readFile(join(root, name), 'utf8');
  if (!text.includes(pair.split('/').at(-1))) throw new Error(`Missing language link in ${name}`);
  if (/TODO|TBD|待补充|待完善/.test(text)) throw new Error(`Unfinished document: ${name}`);
}
console.log(`Checked ${all.size} paired documents / 已检查 ${all.size} 份双语文档`);
