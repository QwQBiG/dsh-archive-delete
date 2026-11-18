import { mkdtemp, realpath, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDshAdapter, type HostContext } from '../src/dsh-adapter.js';
import { isSupportedDshVersion, SUPPORTED_DSH_VERSIONS } from '../src/contracts.js';
import { readHostManifest } from '../src/host-manifest.js';
import { PLUGIN_VERSION } from '../src/version.js';
import { idleReleaseStructurePassed } from '../src/host-diagnostics.js';

const help = `Usage: node --import tsx scripts/probe-host.mts --runtime ABSOLUTE_PATH
  --runtime PATH   Installed DSH runtime or @deepseek-ai/dsh package directory
                   (defaults to DSH_RUNTIME_ROOT)
  --help           Show this help without loading DSH

Creates a temporary stock-service context, probes its lifecycle structure and
removes the temporary data. It does not open a user profile or start the app.
No sessions are created: session-owner checks are reported as untested.
JSON omits paths, session IDs and raw host errors.
Exit 0: structure, supported version and platform passed (owner checks untested).
Exit 1: structural refusal or unverified version/platform; 2: setup failure.

用法：node --import tsx scripts/probe-host.mts --runtime 运行时绝对路径
创建临时的官方服务上下文，检查结构后清理临时数据；不打开用户 profile 或启动桌面应用。
不创建会话，因此会话所有者检查显示为 untested。JSON 不包含路径、会话 ID 或原始错误。
退出码 0：结构、支持版本与平台检查通过（会话所有者未验证）；1：探测拒绝或版本/平台未验证；2：用法或初始化错误。
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) { process.stdout.write(help); return; }
  let stage = 'usage'; let directory: string | undefined;
  let closeDomains: (() => Promise<void>) | undefined; let closeBackend: (() => Promise<void>) | undefined;
  let report: Record<string, unknown> | undefined;
  try {
    let runtime = process.env.DSH_RUNTIME_ROOT?.trim();
    if (args.length) {
      if (args.length !== 2 || args[0] !== '--runtime' || !args[1] || args[1].startsWith('--')) throw new Error('usage');
      runtime = args[1];
    }
    if (!runtime || !isAbsolute(runtime) || runtime.includes('\0')) throw new Error('usage');
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('usage');
    stage = 'runtime-manifest';
    const direct = join(runtime, 'package.json');
    let manifest: unknown;
    try { manifest = await readHostManifest(direct); } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    let anchor = direct;
    if (!manifest || typeof manifest !== 'object' || !('name' in manifest) || manifest.name !== '@deepseek-ai/dsh') {
      anchor = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
      manifest = await readHostManifest(anchor);
    }
    if (!manifest || typeof manifest !== 'object' || !('name' in manifest) || manifest.name !== '@deepseek-ai/dsh'
      || !('version' in manifest) || typeof manifest.version !== 'string' || !/^[0-9A-Za-z.+-]{1,128}$/.test(manifest.version)) throw new Error('manifest');
    const version = manifest.version;
    stage = 'runtime-import';
    const requireHost = createRequire(anchor);
    const host = (name: string): Promise<Record<string, any>> => import(pathToFileURL(requireHost.resolve(name)).href);
    const { Context, Service } = await host('@deepseek-ai/cordis');
    const { SessionStore } = await host('@deepseek-ai/dsh-session');
    const { AgentRegistry } = await host('@deepseek-ai/dsh-agent');
    const { AgentLoop } = await host('@deepseek-ai/dsh-agent-loop');
    const { DomainFacility } = await host('@deepseek-ai/dsh-storage-domain');
    const { JsonStorageBackend } = await host('@deepseek-ai/dsh-storage-json');
    const { SessionProjectionRegistry } = await host('@deepseek-ai/dsh-session-projection');
    const { titleProjectionDefinition } = await host('@deepseek-ai/dsh-session-title');
    const { SessionProjectionCache } = await host('@deepseek-ai/dsh-session-projection-cache');
    const { WorkspaceRegistry } = await host('@deepseek-ai/dsh-workspace');
    const jsonl = await host('@deepseek-ai/dsh-session-persistence-jsonl');
    stage = 'runtime-bootstrap';
    directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-host-probe-')));
    const ctx = new Context();
    ctx.provide('profileContext', { installAnchor: anchor });
    const backend = new JsonStorageBackend(join(directory, 'storage')); closeBackend = () => backend.close();
    ctx.provide('storage', { backend: { get: () => backend } });
    const domains = new DomainFacility(ctx, { backend: 'json' }); closeDomains = () => domains.closeAll();
    ctx.provide('storageDomain', domains);
    new SessionStore(ctx);
    const projections = new SessionProjectionRegistry(ctx); projections.register(titleProjectionDefinition);
    const cache = new SessionProjectionCache(ctx, { writeEveryEvents: 200, writeIntervalMs: 5000 }); await cache[Service.init]();
    const sessionsRoot = join(directory, 'sessions'); await mkdir(sessionsRoot);
    await jsonl.apply(ctx, { root: sessionsRoot, compression: 'none' });
    const registry = new WorkspaceRegistry(ctx); await registry[Service.init]();
    new AgentRegistry(ctx);
    // No agent is created; these dependencies are never invoked by the probe.
    ctx.provide('llm', {}); ctx.provide('tools', {}); ctx.provide('systemPrompt', { variable() {} });
    new AgentLoop(ctx, { agents: [], maxParallelToolCalls: 10 });
    stage = 'runtime-probe';
    const adapter = await createDshAdapter(ctx as HostContext, { home: directory });
    if (!adapter.probeIdleRelease) throw new Error('probe');
    const diagnostics = await adapter.probeIdleRelease();
    const capabilities = await adapter.capabilities();
    const supported = isSupportedDshVersion(version);
    const supportedPlatform = ['darwin', 'win32'].includes(process.platform);
    const structurePassed = idleReleaseStructurePassed(diagnostics);
    report = { schemaVersion: 1, ok: capabilities.supported && structurePassed, scope: 'isolated-stock-services', runtimeState: 'unverified',
      pluginVersion: PLUGIN_VERSION, host: { version, platform: process.platform, supportedVersion: supported, supportedPlatform, supportedVersions: SUPPORTED_DSH_VERSIONS },
      capabilities: { supported: capabilities.supported, ...(capabilities.reasonCode ? { reasonCode: capabilities.reasonCode } : {}) },
      idleRelease: diagnostics,
      note: 'Checks describe a temporary stock-service context. No user profile or session was opened; session-owner checks remain untested.' };
    process.exitCode = capabilities.supported && structurePassed ? 0 : 1;
  } catch {
    report = { schemaVersion: 1, ok: false, scope: 'isolated-stock-services', runtimeState: 'unverified',
      error: { code: stage === 'usage' ? 'probe-usage' : 'probe-bootstrap', stage,
        message: stage === 'usage' ? 'Use --help and pass an installed runtime as an absolute path.' : 'The isolated host probe could not complete this stage.' } };
    process.exitCode = 2;
  } finally {
    try {
      let cleanupFailed = false;
      try { await closeDomains?.(); } catch { cleanupFailed = true; }
      try { await closeBackend?.(); } catch { cleanupFailed = true; }
      if (directory) await rm(directory, { recursive: true, force: true });
      if (cleanupFailed) throw new Error('cleanup');
    } catch {
      report = { schemaVersion: 1, ok: false, scope: 'isolated-stock-services', runtimeState: 'unverified',
        error: { code: 'probe-cleanup', stage: 'runtime-cleanup', message: 'Temporary probe resources could not be fully closed.' } };
      process.exitCode = 2;
    }
    if (report) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  }
}
await main();
