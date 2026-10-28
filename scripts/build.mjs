import { build } from 'esbuild';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const stage = join(root, `.build-${randomUUID()}`);
const output = join(root, 'lib');
const backup = `${stage}-previous`;
let old = false;
await mkdir(stage);
try {
  await build({ entryPoints: [resolve(root, 'src/index.ts')], outfile: join(stage, 'index.js'),
    bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', legalComments: 'inline' });
  const client = await build({ entryPoints: [resolve(root, 'src/client.tsx')], bundle: true,
    format: 'cjs', platform: 'browser', target: 'es2022', write: false,
    external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/*'],
    define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'inline' });
  const code = client.outputFiles[0]?.text;
  if (!code) throw new Error('Client output was not generated.');
  await writeFile(join(stage, 'client.js'), `window.__ModuleLoader__.load({\n  id: '@qwqbig/dsh-archive-delete',\n  factory: function(require) {\n    var module = {exports: {}}; var exports = module.exports;\n${code}\n    return module.exports.startClient(require);\n  }\n});\n`);
  try { await rename(output, backup); old = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { await rename(stage, output); } catch (e) { if (old) await rename(backup, output); throw e; }
  if (old) await rm(backup, { recursive: true });
} finally { await rm(stage, { recursive: true, force: true }); }
console.log('Built host and native client bundles / 已生成宿主与原生客户端构建产物');
