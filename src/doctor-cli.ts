#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const explicitLanguage = args[args.indexOf('--lang') + 1];
const language = explicitLanguage === 'zh' || (!args.includes('--lang') && /^zh(?:[-_.]|$)/i.test(process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG ?? Intl.DateTimeFormat().resolvedOptions().locale)) ? 'zh' : 'en';
const text = (en: string, zh: string) => language === 'zh' ? zh : en;
const help = text(`Usage: dsh-archive-delete-doctor [options]
  --home PATH      Absolute DSH home (default: DSH_HOME or ~/.dsh)
  --profile NAME   Profile to inspect (default: desktop)
  --runtime PATH   Actual DSH runtime directory (or DSH_RUNTIME_ROOT)
  --lang en|zh     Output language
  --json           Structured JSON output
  --help           Show help without inspecting a profile

Requires Node 24+. This is read-only configuration and access checking.
It cannot prove that a running DSH process loaded the plugin.
Exit 0: all static checks passed; 1: failed or incomplete checks; 2: usage error.
`, `用法：dsh-archive-delete-doctor [选项]
  --home PATH      DSH home 绝对路径（默认 DSH_HOME 或 ~/.dsh）
  --profile NAME   检查的 profile（默认 desktop）
  --runtime PATH   DSH 实际运行时目录（或 DSH_RUNTIME_ROOT）
  --lang en|zh     输出语言
  --json           输出结构化 JSON
  --help           显示帮助，不检查 profile

需要 Node 24+。仅只读核对配置与访问权限，无法证明正在运行的 DSH 已加载插件。
退出码 0：静态检查全部通过；1：检查失败或不完整；2：用法错误。
`);

async function main(): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) { process.stdout.write(help); return; }
  try {
    const values = new Map<string, string>(); let json = false;
    for (let i = 0; i < args.length; i++) {
      const key = args[i]!;
      if (key === '--json' && !json) { json = true; continue; }
      if (!['--home', '--profile', '--runtime', '--lang'].includes(key) || values.has(key)) throw new Error(text(`Unknown or duplicate option: ${key}`, `未知或重复的选项：${key}`));
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(text(`Missing value for ${key}`, `${key} 缺少参数`));
      values.set(key, value);
    }
    if (values.has('--lang') && !['en', 'zh'].includes(values.get('--lang')!)) throw new Error(text('--lang must be en or zh.', '--lang 必须为 en 或 zh。'));
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error(text(`Node 24+ is required; current Node is ${process.versions.node}.`, `需要 Node 24+，当前为 ${process.versions.node}。`));
    const { runDoctor, formatDoctorReport } = await import('./doctor.js');
    const runtimeRoot = values.get('--runtime') ?? process.env.DSH_RUNTIME_ROOT?.trim();
    const report = await runDoctor({ home: values.get('--home') ?? (process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')),
      profile: values.get('--profile') ?? 'desktop', language, ...(runtimeRoot ? { runtimeRoot } : {}) });
    process.stdout.write(json ? JSON.stringify(report, null, 2) + '\n' : formatDoctorReport(report));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.includes('--json')) process.stdout.write(JSON.stringify({ ok: false, error: { code: 'doctor-usage', message } }) + '\n');
    else process.stderr.write(`${message}\n${text('Use --help for usage.', '请使用 --help 查看用法。')}\n`);
    process.exitCode = 2;
  }
}
await main();
