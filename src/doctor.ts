import { constants } from 'node:fs';
import { access, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { PACKAGE_NAME, SUPPORTED_DSH_VERSIONS, SUPPORTED_DSH_VERSION_LABEL, isSupportedDshVersion } from './contracts.js';
import { assertCanonicalStoragePath, assertLocalStoragePath, assertPlainDirectory, assertPrivateDirectory, readBoundedJson } from './filesystem.js';
import { PLUGIN_VERSION } from './version.js';
import { readHostManifest } from './host-manifest.js';

export type DoctorLanguage = 'en' | 'zh';
export type DoctorStatus = 'pass' | 'warn' | 'fail';
export interface DoctorCheck { id: string; status: DoctorStatus; code: string; message: string; path?: string }
export interface DoctorOptions { home: string; profile?: string; runtimeRoot?: string; language?: DoctorLanguage }
export interface DoctorReport {
  schemaVersion: 1;
  ok: boolean;
  status: DoctorStatus;
  language: DoctorLanguage;
  plugin: { name: string; version: string; installedVersion?: string };
  home: string;
  profile: { name: string; directory: string };
  targetDshVersion: string;
  supportedDshVersions: readonly string[];
  host: { version: string; source: 'explicit-runtime' | 'profile-resolution' | 'unresolved'; manifest?: string };
  runtimeState: 'unverified';
  checks: DoctorCheck[];
  note: string;
}

type Manifest = Record<string, unknown>;
function record(value: unknown): value is Manifest { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function code(error: unknown): string | undefined { return record(error) && typeof error.code === 'string' ? error.code : undefined; }
async function manifest(path: string): Promise<Manifest> {
  const data = await readBoundedJson(path, 1024 * 1024);
  if (!record(data)) throw new Error('invalid manifest');
  return data;
}
async function hostCodeManifest(path: string): Promise<Manifest> {
  const data = await readHostManifest(path);
  if (!record(data)) throw new Error('invalid host manifest');
  return data;
}
function version(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128; }

/** Inspect configuration and permissions only. Never load plugin code or write a probe file. */
export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const language = options.language ?? 'en';
  const text = (en: string, zh: string) => language === 'zh' ? zh : en;
  const profile = options.profile ?? 'desktop';
  if (!isAbsolute(options.home)) throw new Error(text('--home must be an absolute path.', '--home 必须是绝对路径。'));
  if (!profile || profile.length > 255 || /[/\\\0]/.test(profile) || ['.', '..', 'node_modules'].includes(profile))
    throw new Error(text('--profile must name one profile, without path separators.', '--profile 必须为单个 profile 名称，不得包含路径分隔符。'));
  if (options.runtimeRoot !== undefined && !isAbsolute(options.runtimeRoot))
    throw new Error(text('--runtime must be an absolute runtime directory.', '--runtime 必须为运行时目录的绝对路径。'));
  const profileDirectory = join(options.home, 'profiles', profile);
  assertLocalStoragePath(options.home); assertLocalStoragePath(profileDirectory);
  const checks: DoctorCheck[] = [];
  const add = (id: string, status: DoctorStatus, problem: string, en: string, zh: string, path?: string) => {
    checks.push({ id, status, code: problem, message: text(en, zh), ...(path ? { path } : {}) });
  };
  const report: DoctorReport = {
    schemaVersion: 1, ok: false, status: 'warn', language, plugin: { name: PACKAGE_NAME, version: PLUGIN_VERSION },
    home: options.home, profile: { name: profile, directory: profileDirectory }, targetDshVersion: SUPPORTED_DSH_VERSION_LABEL,
    supportedDshVersions: [...SUPPORTED_DSH_VERSIONS],
    host: { version: 'unknown', source: 'unresolved' }, runtimeState: 'unverified', checks,
    note: text('This read-only check does not prove that DSH is running or has loaded this plugin. Fully quit and reopen the selected profile, then check its component status, loaded log, and management button.',
      '此只读检查无法证明 DSH 正在运行或已加载插件。请完全退出后重新打开所选 profile，再检查组件状态、加载日志和管理按钮。'),
  };
  add('platform', ['darwin', 'win32'].includes(process.platform) ? 'pass' : 'fail', 'host-platform',
    `Platform: ${process.platform}. Supported targets are macOS and Windows Desktop.`, `平台：${process.platform}。支持 macOS 和 Windows 桌面端。`);
  let selected: Manifest | undefined;
  const profileManifest = join(profileDirectory, 'package.json');
  try {
    await assertCanonicalStoragePath(options.home); await assertPlainDirectory(profileDirectory);
    await assertCanonicalStoragePath(profileDirectory);
    selected = await manifest(profileManifest);
    add('profile', 'pass', 'profile-readable', 'The selected profile manifest is readable.', '所选 profile 清单可读取。', profileManifest);
  } catch (error) {
    add('profile', 'fail', code(error) === 'ENOENT' ? 'profile-missing' : 'profile-unreadable',
      'The selected profile is missing, unsafe, or its package.json is invalid. Check --home and --profile; no profile was created or changed.',
      '所选 profile 不存在、路径不安全或 package.json 无效。请检查 --home 和 --profile；未创建或修改任何 profile。', profileManifest);
  }
  const dsh = selected && record(selected.dsh) ? selected.dsh : undefined;
  const settings = dsh && record(dsh.profile) ? dsh.profile : undefined;
  const bundles = settings?.bundles;
  if (!Array.isArray(bundles) || !bundles.every(item => typeof item === 'string')) {
    add('bundle-registration', 'fail', 'bundle-list-invalid', 'The profile has no valid dsh.profile.bundles array. Repair its configuration before enabling this plugin.',
      'profile 中没有有效的 dsh.profile.bundles 数组。请先修复配置，再启用插件。', profileManifest);
  } else if (!bundles.includes(PACKAGE_NAME)) {
    add('bundle-registration', 'fail', 'bundle-not-registered', 'The plugin bundle is not registered in this profile. Enable it through the plugin manager, or add its name once while preserving existing entries.',
      '插件 bundle 尚未登记在此 profile。请通过插件管理器启用，或保留已有条目并补入一次插件包名。', profileManifest);
  } else if (bundles.filter(item => item === PACKAGE_NAME).length !== 1) {
    add('bundle-registration', 'warn', 'bundle-duplicated', 'The plugin bundle appears more than once. Fully quit DSH and remove only duplicate copies of this package name.',
      '插件 bundle 重复登记。请完全退出 DSH，仅删除此包名的重复条目。', profileManifest);
  } else add('bundle-registration', 'pass', 'bundle-registered', 'The plugin bundle is registered once in the selected profile.', '插件 bundle 已在所选 profile 中登记一次。', profileManifest);

  try {
    const pluginManifest = createRequire(profileManifest).resolve(`${PACKAGE_NAME}/package.json`);
    const installed = await manifest(pluginManifest);
    if (installed.name !== PACKAGE_NAME || !version(installed.version)) throw new Error('unexpected package');
    report.plugin.installedVersion = installed.version;
    const directory = dirname(pluginManifest);
    // Earlier valid releases predate Doctor; diagnose a tool/version mismatch
    // rather than calling their complete package corrupt.
    const artifacts = ['lib/index.js', 'lib/client.js', 'cordis.patch.yml'];
    if (installed.version === PLUGIN_VERSION) artifacts.push('lib/doctor.js');
    for (const filename of artifacts) {
      const stat = await lstat(join(directory, filename));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid package artifact');
    }
    add('installation', installed.version === PLUGIN_VERSION ? 'pass' : 'warn', installed.version === PLUGIN_VERSION ? 'package-installed' : 'doctor-version-differs',
      installed.version === PLUGIN_VERSION ? `Installed package ${installed.version} contains its precompiled artifacts.` : `Installed package ${installed.version} differs from this doctor ${PLUGIN_VERSION}. Run the doctor shipped with that installation.`,
      installed.version === PLUGIN_VERSION ? `已安装的 ${installed.version} 包含预编译产物。` : `已安装的 ${installed.version} 与当前自检工具 ${PLUGIN_VERSION} 不一致。请使用该安装包自带的自检工具。`, pluginManifest);
  } catch {
    add('installation', 'fail', 'package-missing-or-incomplete', 'The plugin package is missing, unresolved, or incomplete. Install the release asset into this profile; a stale bundle entry alone cannot load it.',
      '插件包不存在、无法解析或不完整。请将 Release 安装包安装到此 profile；只有残留的 bundle 条目无法加载插件。', profileDirectory);
  }

  try {
    let hostManifest: string;
    if (options.runtimeRoot !== undefined) {
      assertLocalStoragePath(options.runtimeRoot);
      const direct = join(options.runtimeRoot, 'package.json');
      let directManifest: Manifest | undefined;
      try { directManifest = await hostCodeManifest(direct); } catch (error) { if (code(error) !== 'ENOENT') throw error; }
      hostManifest = directManifest?.name === '@deepseek-ai/dsh' ? direct : join(options.runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
      report.host.source = 'explicit-runtime';
    } else {
      hostManifest = createRequire(profileManifest).resolve('@deepseek-ai/dsh/package.json');
      report.host.source = 'profile-resolution';
    }
    const installed = await hostCodeManifest(hostManifest);
    if (installed.name !== '@deepseek-ai/dsh' || !version(installed.version)) throw new Error('unexpected host');
    report.host.manifest = hostManifest; report.host.version = installed.version;
    const match = isSupportedDshVersion(installed.version);
    add('host-version', match ? 'pass' : 'fail', match ? 'host-version-matches' : 'host-version-mismatch',
      `Selected runtime: DSH ${installed.version}; supported: ${SUPPORTED_DSH_VERSION_LABEL}.${match ? ' This does not identify a running process.' : ' Install a supported DSH Desktop version, then fully quit and reopen it.'}`,
      `所选运行时：DSH ${installed.version}；支持：${SUPPORTED_DSH_VERSION_LABEL}。${match ? '此结果不代表已识别正在运行的进程。' : '请使用支持的 DSH 桌面端版本，然后完全退出并重新打开。'}`, hostManifest);
  } catch {
    report.host.source = 'unresolved';
    add('host-version', options.runtimeRoot === undefined ? 'warn' : 'fail', 'host-runtime-unresolved',
      options.runtimeRoot === undefined ? 'The host runtime cannot be identified from this profile. Pass --runtime with the installation directory used by DSH; plugin peer dependencies are not host-version evidence.' : 'The explicit runtime does not contain a readable @deepseek-ai/dsh manifest. Check --runtime; no runtime was installed or changed.',
      options.runtimeRoot === undefined ? '无法从此 profile 确认宿主运行时。请通过 --runtime 指定 DSH 实际使用的安装目录；插件的 peer 依赖不能作为宿主版本证据。' : '指定运行时没有可读取的 @deepseek-ai/dsh 清单。请检查 --runtime；未安装或修改运行时。', options.runtimeRoot);
  }

  const archiveRoot = join(options.home, 'archive-delete');
  let storageSafe = false;
  try {
    await assertPrivateDirectory(archiveRoot); await assertCanonicalStoragePath(archiveRoot);
    storageSafe = true;
    const missing: string[] = [];
    for (const area of ['trash', 'staging', 'receipts', 'operations']) {
      const path = join(archiveRoot, area);
      try { await assertPrivateDirectory(path); await assertCanonicalStoragePath(path); }
      catch (error) { if (code(error) === 'ENOENT') missing.push(area); else throw error; }
    }
    add('storage', missing.length ? 'warn' : 'pass', missing.length ? 'storage-not-initialized' : 'storage-layout-ready',
      missing.length ? `Storage is not fully initialized; missing: ${missing.join(', ')}. Start the supported host with this profile.` : 'All four plugin storage directories are present and safe. Their presence is not proof of live loading.',
      missing.length ? `存储尚未完全初始化，缺少：${missing.join('、')}。请用此 profile 启动受支持的宿主。` : '四个插件存储目录均存在且安全。目录存在不代表当前已加载插件。', archiveRoot);
  } catch (error) {
    storageSafe = false;
    add('storage', code(error) === 'ENOENT' ? 'warn' : 'fail', code(error) === 'ENOENT' ? 'storage-not-initialized' : 'storage-unsafe',
      code(error) === 'ENOENT' ? 'Plugin storage has not been initialized. Fully quit and reopen DSH with the selected profile; no directories were created by this check.' : 'Plugin storage is unsafe or inaccessible. Retain its data and inspect permissions and canonical paths before retrying.',
      code(error) === 'ENOENT' ? '插件存储尚未初始化。请完全退出并用所选 profile 重新打开 DSH；此检查未创建任何目录。' : '插件存储不安全或无法访问。请保留数据，核对权限与规范路径后重试。', archiveRoot);
  }
  const trash = join(archiveRoot, 'trash');
  if (storageSafe) {
    try {
      await assertPrivateDirectory(trash); await assertCanonicalStoragePath(trash); await access(trash, constants.W_OK);
      add('trash-writable', 'pass', 'trash-access-passed', 'The current process passes the trash write-access check. No probe file was created; a later operation can still fail.',
        '当前进程通过回收站写入权限检查。未创建探测文件，后续实际操作仍可能失败。', trash);
    } catch (error) {
      add('trash-writable', code(error) === 'ENOENT' ? 'warn' : 'fail', code(error) === 'ENOENT' ? 'trash-not-initialized' : 'trash-not-writable',
        code(error) === 'ENOENT' ? 'Trash is not initialized yet; start the supported host with this profile.' : 'Trash write access is unavailable or unsafe. Check permissions without deleting recovery data.',
        code(error) === 'ENOENT' ? '回收站尚未初始化，请用此 profile 启动受支持的宿主。' : '回收站不可安全写入。请检查权限，保留恢复数据。', trash);
    }
  } else add('trash-writable', 'warn', 'trash-access-not-checked', 'Write access was not checked because plugin storage is absent or unsafe.', '插件存储不存在或不安全，因此未检查写入权限。', trash);
  report.status = checks.some(check => check.status === 'fail') ? 'fail' : checks.some(check => check.status === 'warn') ? 'warn' : 'pass';
  report.ok = report.status === 'pass';
  return report;
}

export function formatDoctorReport(report: DoctorReport): string {
  const zh = report.language === 'zh';
  const lines = [`${PACKAGE_NAME} ${report.plugin.version} · ${zh ? '只读自检' : 'read-only doctor'}`,
    `${zh ? '所选 profile' : 'Selected profile'}: ${report.profile.name} (${report.profile.directory})`,
    ...report.checks.map(check => `[${check.status.toUpperCase()}] ${check.id}: ${check.message}${check.path ? `\n  ${check.path}` : ''}`),
    '', report.note];
  return lines.join('\n') + '\n';
}
