import { spawn } from 'node:child_process';
import { access, appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const version = '0.2.1-rc.3';
async function announce(root) {
  const manifest = JSON.parse(await readFile(join(root, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'));
  if (manifest.name !== '@deepseek-ai/dsh' || manifest.version !== version) throw new Error('Unexpected native runtime version / 原生运行时版本不匹配');
  if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `DSH_RUNTIME_ROOT=${root}\n`);
  console.log(`Native test runtime ready / 原生测试运行时已就绪: DSH_RUNTIME_ROOT=${root}`);
}
const installed = '/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh';
const existing = process.env.DSH_RUNTIME_ROOT ?? installed;
try { await access(join(existing, 'node_modules/@deepseek-ai/dsh/package.json')); await announce(existing); process.exit(0); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (process.env.CI !== 'true') throw new Error('Reuse the installed DSH app or set DSH_RUNTIME_ROOT; this helper downloads only in CI / 请复用已安装 DSH 或设置 DSH_RUNTIME_ROOT；此脚本仅在 CI 中下载');
if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Native integration verification requires macOS or Windows / 原生集成验证需要 macOS 或 Windows');
// Invoke npm's JavaScript CLI with this Node process. Windows command shims
// cannot be passed to child_process.spawn() without an intermediate shell.
const npmCandidates = [
  ...(process.env.DSH_NPM_CLI ? [process.env.DSH_NPM_CLI] : []),
  ...(process.env.npm_execpath && basename(process.env.npm_execpath) === 'npm-cli.js' ? [process.env.npm_execpath] : []),
  join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
];
let npmCli;
for (const path of npmCandidates) {
  try { await access(path); npmCli = path; break; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (!npmCli) throw new Error('Cannot locate npm-cli.js. Set DSH_NPM_CLI to its absolute path / 无法定位 npm-cli.js，请通过 DSH_NPM_CLI 指定绝对路径');
// Keep the official runtime separate from the plugin and every user DSH profile.
const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'dsh-archive-delete-runtime-'));
await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'dsh-archive-delete-native-test-runtime', private: true, version: '0.0.0' }));
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [npmCli, 'install', '--prefix', root, '--save-exact', '--include=optional', '--install-strategy=hoisted', '--ignore-scripts', '--no-audit', '--no-fund', `@deepseek-ai/dsh@${version}`], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (status, signal) => status === 0 ? resolve() : reject(new Error(`Native runtime installation failed / 原生运行时安装失败: ${status ?? signal}`)));
});
await announce(root);
