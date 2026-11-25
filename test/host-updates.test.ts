import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { SUPPORTED_DSH_VERSION } from '../src/contracts.js';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/check-host-updates.mjs', import.meta.url));
const desktop = 'https://download.deepseek.com/dsh-desk/feeds';
const windowsStable = `${desktop}/win-x64/stable.yml`;
const windowsNightly = `${desktop}/win-x64/nightly.yml`;
const macStable = `${desktop}/mac-arm64/stable-mac.yml`;
const macNightly = `${desktop}/mac-arm64/nightly-mac.yml`;
const runtime = (version: string) => `https://registry.npmjs.org/@deepseek-ai%2Fdsh/${version}`;
const published = (version: string) => ({ body: JSON.stringify({ name: '@deepseek-ai/dsh', version }) });

type Responses = Record<string, { body?: string; status?: number }>;

async function check(t: TestContext, responses: Responses, version = '') {
  const directory = await mkdtemp(join(tmpdir(), 'archive-host-watch-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'outputs');
  const summary = join(directory, 'summary');
  const mock = `
    const responses = JSON.parse(process.env.HOST_WATCH_FIXTURES);
    globalThis.fetch = async url => {
      if (!Object.hasOwn(responses, url)) throw new Error('Unexpected request: ' + url);
      const { body = '', status = 200 } = responses[url];
      delete responses[url]; // a repeated version lookup must fail
      return new Response(body, { status });
    };
  `;
  const preload = `data:text/javascript,${encodeURIComponent(mock)}`;
  const env = { ...process.env, HOST_WATCH_FIXTURES: JSON.stringify(responses),
    DSH_CANDIDATE_VERSION: version, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary };
  try {
    const { stdout, stderr } = await exec(process.execPath, ['--import', preload, script], { env });
    return { ok: true, stdout, stderr, output: await readFile(output, 'utf8'), summary: await readFile(summary, 'utf8') };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return { ok: false, stdout: failed.stdout, stderr: failed.stderr,
      output: await readFile(output, 'utf8').catch(() => ''), summary: await readFile(summary, 'utf8').catch(() => '') };
  }
}

test('desktop discovery queues each exact published candidate once across channels and platforms', async t => {
  const candidate = '0.99.0-rc.4';
  const missing = '0.99.1-rc.1';
  const result = await check(t, {
    [windowsStable]: { body: `version: ${SUPPORTED_DSH_VERSION}\n` },
    [windowsNightly]: { body: `version: "${candidate}"\r\nfiles:\r\n` },
    [macStable]: { body: `version: '${candidate}' # a stable rollout\n` },
    [macNightly]: { body: `version: ${missing}\n` },
    [runtime(candidate)]: published(candidate),
    [runtime(missing)]: { status: 404 },
  });
  assert.equal(result.ok, true, result.stderr);
  assert.equal(result.output, `versions=["${candidate}"]\n`);
  assert.match(result.summary, /Windows x64 stable.*Listed in this checkout/);
  assert.match(result.summary, /Windows x64 nightly.*Native tests queued/);
  assert.match(result.summary, /macOS arm64 stable.*Native tests queued/);
  assert.match(result.summary, /macOS arm64 nightly.*Exact npm runtime not published/);
});

test('an ambiguous feed and absent feed do not suppress another published candidate', async t => {
  const candidate = '0.99.0-rc.5';
  const mismatch = '0.99.0-rc.6';
  const result = await check(t, {
    [windowsStable]: { body: 'version: 0.99.0-rc.2\nversion: 0.99.0-rc.3\n' },
    [windowsNightly]: { body: `version: ${candidate}\n` },
    [macStable]: { status: 503 },
    [macNightly]: { body: `version: ${mismatch}\n` },
    [runtime(candidate)]: published(candidate),
    [runtime(mismatch)]: published(candidate),
  });
  assert.equal(result.ok, false);
  assert.equal(result.output, `versions=["${candidate}"]\n`);
  assert.match(result.summary, /Windows x64 stable.*Feed unavailable/);
  assert.match(result.summary, /macOS arm64 stable.*Feed unavailable/);
  assert.match(result.summary, /macOS arm64 nightly.*Exact runtime could not be verified/);
});

test('a manual request can recheck a supported version and refuses an unpublished runtime', async t => {
  const good = await check(t, { [runtime(SUPPORTED_DSH_VERSION)]: published(SUPPORTED_DSH_VERSION) }, SUPPORTED_DSH_VERSION);
  assert.equal(good.ok, true, good.stderr);
  assert.equal(good.output, `versions=["${SUPPORTED_DSH_VERSION}"]\n`);
  assert.match(good.summary, /Manual request.*Native tests queued/);

  const missing = '0.99.2-alpha.1';
  const absent = await check(t, { [runtime(missing)]: { status: 404 } }, missing);
  assert.equal(absent.ok, false);
  assert.equal(absent.output, 'versions=[]\n');
  assert.match(absent.summary, /Manual request.*Exact npm runtime not published/);
});

test('a manual range is rejected before writing a candidate matrix', async t => {
  const result = await check(t, {}, '>=0.2.2-rc.5');
  assert.equal(result.ok, false);
  assert.equal(result.output, '');
  assert.match(result.stderr ?? '', /Enter one exact DSH version/);
});
