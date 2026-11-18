import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { emptyIdleReleaseDiagnostics, idleReleaseStructurePassed } from '../src/host-diagnostics.js';

test('host probe requires every global check to pass and distinguishes untested owners from untested structure', () => {
  const report = emptyIdleReleaseDiagnostics();
  assert.equal(idleReleaseStructurePassed(report), false);
  for (const check of report.checks) {
    if (!['agent-state', 'lifecycle-owner-missing'].includes(check.code)) check.status = 'pass';
  }
  assert.equal(idleReleaseStructurePassed(report), true);
  const unknownGlobal = structuredClone(report); unknownGlobal.checks.find(check => check.code === 'factory-identity')!.status = 'untested';
  assert.equal(idleReleaseStructurePassed(unknownGlobal), false);
  const missingGlobal = structuredClone(report); missingGlobal.checks = missingGlobal.checks.filter(check => check.code !== 'factory-identity');
  assert.equal(idleReleaseStructurePassed(missingGlobal), false);
  const failedOwner = structuredClone(report); failedOwner.checks.find(check => check.code === 'lifecycle-owner-missing')!.status = 'fail';
  assert.equal(idleReleaseStructurePassed(failedOwner), false);
});

function probe(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/probe-host.mts', ...args], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, DSH_RUNTIME_ROOT: '' }, encoding: 'utf8', timeout: 15000,
  });
}

test('host probe help does not load a runtime or request a user profile', () => {
  const result = probe(['--help']);
  assert.equal(result.status, 0); assert.equal(result.stderr, '');
  assert.match(result.stdout, /owner checks untested/);
  assert.match(result.stdout, /不打开用户 profile/);
});

test('host probe rejects user-profile options and omits raw paths from setup failures', () => {
  for (const args of [[], ['--home', 'private-user-home'], ['--runtime', 'relative-runtime']]) {
    const result = probe(args); const report = JSON.parse(result.stdout);
    assert.equal(result.status, 2); assert.equal(report.error.code, 'probe-usage');
    assert.equal(report.runtimeState, 'unverified');
    assert.equal(result.stdout.includes('private-user-home'), false);
  }
  const privatePath = join(tmpdir(), `private-probe-${randomUUID()}`);
  const missing = probe(['--runtime', privatePath]); const report = JSON.parse(missing.stdout);
  assert.equal(missing.status, 2); assert.equal(report.error.code, 'probe-bootstrap');
  assert.equal(report.error.stage, 'runtime-manifest');
  assert.equal(missing.stdout.includes(privatePath), false);
  assert.equal(missing.stderr, '');
});
