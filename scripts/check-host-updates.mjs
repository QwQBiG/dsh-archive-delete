import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const desktopFeed = 'https://download.deepseek.com/dsh-desk/feeds';
const feeds = [
  ['Windows x64 stable', `${desktopFeed}/win-x64/stable.yml`],
  ['Windows x64 nightly', `${desktopFeed}/win-x64/nightly.yml`],
  ['macOS arm64 stable', `${desktopFeed}/mac-arm64/stable-mac.yml`],
  ['macOS arm64 nightly', `${desktopFeed}/mac-arm64/nightly-mac.yml`],
];
const npmRuntime = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh';
const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*))?$/;

export function isExactDshVersion(version) {
  if (typeof version !== 'string' || version.length > 100) return false;
  const match = exactVersion.exec(version);
  return match !== null && match[0] === version && match.slice(1, 4).every(part => Number.isSafeInteger(Number(part)))
    && (!match[4] || match[4].split('.').every(part => !/^\d+$/.test(part) || part === '0' || !part.startsWith('0')));
}

export function declaredDshVersions(manifest) {
  const requirement = manifest?.engines?.dsh;
  const versions = typeof requirement === 'string' ? requirement.split('||').map(item => item.trim()) : [];
  if (!versions.length || !versions.every(isExactDshVersion) || new Set(versions).size !== versions.length)
    throw new Error('engines.dsh must list unique exact DSH versions.');
  return versions;
}

async function boundedText(response, limit) {
  if (!response.body) throw new Error('Response has no body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let result = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return result + decoder.decode();
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('Response exceeded its size limit.');
      result += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
}

function fetchMetadata(url) {
  return fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error', cache: 'no-store' });
}

async function desktopVersion([source, url]) {
  try {
    const response = await fetchMetadata(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Electron's feed uses a single top-level scalar. It may be quoted.
    const lines = (await boundedText(response, 64 * 1024)).split(/\r?\n/).filter(line => /^version[ \t]*:/.test(line));
    const scalar = lines.length === 1
      ? /^version[ \t]*:[ \t]*(?:(['"])([^'"]+)\1|([^ \t#]+))[ \t]*(?:#.*)?$/.exec(lines[0])
      : null;
    const version = scalar?.[2] ?? scalar?.[3];
    if (!isExactDshVersion(version)) throw new Error('Missing or invalid version');
    return { source, version };
  } catch {
    return { source, status: 'feed-unavailable' };
  }
}

async function runtimeAvailability(version) {
  try {
    const response = await fetchMetadata(`${npmRuntime}/${encodeURIComponent(version)}`);
    if (response.status === 404) return 'runtime-not-published';
    if (!response.ok) return 'registry-unavailable';
    const manifest = JSON.parse(await boundedText(response, 1024 * 1024));
    return manifest?.name === '@deepseek-ai/dsh' && manifest.version === version ? 'queued' : 'registry-unavailable';
  } catch {
    return 'registry-unavailable';
  }
}

async function discover(supported, requested) {
  const sources = requested ? [{ source: 'Manual request', version: requested }] : await Promise.all(feeds.map(desktopVersion));
  const needed = new Set(sources.flatMap(({ version }) => version && (requested || !supported.has(version)) ? [version] : []));
  const operations = await Promise.all([...needed].map(async version => [version, await runtimeAvailability(version)]));
  const availability = new Map(operations);
  return {
    versions: operations.filter(([, status]) => status === 'queued').map(([version]) => version),
    sources: sources.map(source => source.status ? source
      : { ...source, status: availability.get(source.version) ?? 'supported' }),
  };
}

async function main() {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const supported = new Set(declaredDshVersions(manifest));
  const requested = process.env.DSH_CANDIDATE_VERSION?.trim();
  if (requested && !isExactDshVersion(requested)) throw new Error('Enter one exact DSH version, such as 0.2.2-rc.5.');
  const report = await discover(supported, requested);
  const labels = {
    supported: 'Listed in this checkout / 当前代码已声明支持',
    queued: 'Native tests queued / 已安排原生测试',
    'feed-unavailable': 'Feed unavailable or malformed / 更新源不可用或格式无效',
    'registry-unavailable': 'Exact runtime could not be verified / 无法验证该版本的运行时',
    'runtime-not-published': 'Exact npm runtime not published / npm 尚未发布对应运行时',
  };
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `versions=${JSON.stringify(report.versions)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = report.sources.map(({ source, version, status }) => `| ${source} | ${version ?? '—'} | ${labels[status]} |`);
    const reportMarkdown = ['## DSH Desktop update check / 桌面端版本检查', '', '| Source / 来源 | DSH | Result / 结果 |',
      '| --- | --- | --- |', ...rows, ''].join('\n');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, reportMarkdown);
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.sources.some(({ status }) => status === 'feed-unavailable' || status === 'registry-unavailable')
      || (requested && report.versions.length === 0)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
