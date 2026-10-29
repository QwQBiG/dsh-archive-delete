import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const filename = `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`;
const path = join(resolve(process.argv[2] ?? 'artifacts'), filename);
const bytes = await readFile(path);
const sha256 = createHash('sha256').update(bytes).digest('hex');
await writeFile(`${path}.sha256`, `${sha256}  ${filename}\n`);
console.log(JSON.stringify({ file: filename, bytes: bytes.length, sha256 }));
