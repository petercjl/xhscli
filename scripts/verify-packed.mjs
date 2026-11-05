import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rename, stat, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { managedNpm } from '../src/package-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const scratch = await mkdtemp(join(tmpdir(), 'xhscli-package-'));
const env = { ...process.env, AGENT_PACKAGE_UPDATE_CHECK: '0' };
function run(command, args, { cwd = root, expected = 0 } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 180000 });
  assert.equal(result.status, expected, [command, ...args].join(' ') + '\n' + result.stdout + result.stderr);
  return result.stdout;
}
const npm = managedNpm();
function npmRun(args) {
  const result = spawnSync(npm.command, [...npm.args, ...args], { cwd: root, env, encoding: 'utf8', timeout: 180000, shell: npm.shell });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
const packed = JSON.parse(npmRun(['pack', '--ignore-scripts', '--pack-destination', scratch, '--json']));
const tarball = Array.isArray(packed) ? packed[0] : packed[pkg.name];
assert.equal(typeof tarball?.filename, 'string', 'npm pack did not identify the package tarball');
npmRun(['install', '--prefix', join(scratch, 'bootstrap'), '--ignore-scripts', '--no-audit', '--no-fund', join(scratch, tarball.filename)]);
const entry = join(scratch, 'bootstrap', 'node_modules', '@petercjl', 'xhscli', 'src', 'cli.mjs');
const invoke = (args, expected = 0) => JSON.parse(run(process.execPath, [entry, ...args, '--json'], { expected }));
assert.equal(invoke(['version']).version, pkg.version);
const installedRoot = join(scratch, 'bootstrap', 'node_modules', '@petercjl', 'xhscli');
const skillVersionPath = join(installedRoot, 'skill', 'xhscli', 'package.json');
const skillVersion = await readFile(skillVersionPath);
await writeFile(skillVersionPath, JSON.stringify({ name: 'xhscli', version: '0.0.0' }));
run(process.execPath, [join(installedRoot, 'scripts', 'verify-package.mjs')], { expected: 1 });
await writeFile(skillVersionPath, skillVersion);
run(process.execPath, [join(installedRoot, 'scripts', 'verify-package.mjs')]);
assert.equal(invoke(['skill', 'install'], 1).code, 'TARGET_REQUIRED');
assert.equal(invoke(['skill', 'install', '--agent', 'INVALID!', '--target-dir', join(scratch, 'invalid')], 1).code, 'INVALID_AGENT');

for (const host of ['first-agent', 'another-runtime']) {
  const parent = join(scratch, host);
  const options = ['--agent', host, '--target-dir', parent];
  assert.equal(invoke(['skill', 'install', ...options]).current, true);
  assert.equal(invoke(['skill', 'update', ...options]).changed, false);
  assert.equal(invoke(['update', 'install', '--version', pkg.version, ...options]).skill.current, true);
}
const first = join(scratch, 'first-agent', 'xhscli');
const second = join(scratch, 'another-runtime', 'xhscli');
const metadata = join(first, 'agents', 'openai.yaml');
const oldMetadata = await readFile(metadata);
await writeFile(metadata, 'interface:\n  display_name: "Local customization"\n  short_description: "Local metadata"\n');
assert.equal(invoke(['skill', 'update', '--agent', 'first-agent', '--target-dir', join(scratch, 'first-agent')]).current, true);
assert.match(await readFile(metadata, 'utf8'), /Local customization/);

const skill = join(first, 'SKILL.md');
const original = await readFile(skill);
await writeFile(skill, Buffer.concat([original, Buffer.from('\nLocal business edit\n')]));
assert.equal(invoke(['skill', 'status', '--agent', 'first-agent', '--target-dir', join(scratch, 'first-agent')]).current, false);
const protectedResult = invoke(['skill', 'update', '--agent', 'first-agent', '--target-dir', join(scratch, 'first-agent')], 1);
assert.equal(protectedResult.ok, false);
assert.match(await readFile(skill, 'utf8'), /Local business edit/);
await writeFile(skill, original);
await writeFile(metadata, oldMetadata);

const unmanaged = join(scratch, 'unmanaged', 'xhscli');
await mkdir(unmanaged, { recursive: true });
await writeFile(join(unmanaged, 'SKILL.md'), 'User-owned content', { flag: 'wx' });
assert.equal(invoke(['skill', 'install', '--target-dir', join(scratch, 'unmanaged')], 1).ok, false);
assert.equal(await readFile(join(unmanaged, 'SKILL.md'), 'utf8'), 'User-owned content');
assert.equal((await lstat(first)).isSymbolicLink(), false);
assert.equal((await lstat(second)).isSymbolicLink(), false);
const firstEntry = join(first, '.runtime', 'src', 'cli.mjs');
const secondEntry = join(second, '.runtime', 'src', 'cli.mjs');
assert.notEqual((await stat(firstEntry)).ino, (await stat(secondEntry)).ino);
await rename(join(scratch, 'bootstrap'), join(scratch, 'bootstrap-offline'));
await rename(join(scratch, 'first-agent'), join(scratch, 'first-agent-offline'));
const version = JSON.parse(run(process.execPath, [secondEntry, 'version', '--json']));
assert.equal(version.version, pkg.version);
const source = JSON.parse(run(process.execPath, [secondEntry, 'skill', 'source', '--json']));
const actualSource = await stat(source.source);
const expectedSource = await stat(join(second, '.runtime', 'skill', 'xhscli'));
assert.equal(actualSource.dev, expectedSource.dev);
assert.equal(actualSource.ino, expectedSource.ino);
const existent = join(scratch, 'existing.xlsx');
await writeFile(existent, 'User-owned file', { flag: 'wx' });
const result = JSON.parse(run(process.execPath, [secondEntry, 'search', '--keyword', 'fixture', '--output', existent, '--json'], { expected: 1 }));
assert.equal(result.code, 'OUTPUT_EXISTS');
assert.equal(await readFile(existent, 'utf8'), 'User-owned file');
console.log('Packed lifecycle verified: explicit targets, protected edits, repeat sync, isolated runtime and business entry.');
