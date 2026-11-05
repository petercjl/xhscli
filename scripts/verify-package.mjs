import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const pkg = await json('package.json');
const cap = await json('capabilities.json');
const skill = await json('skill/xhscli/package.json');
const integrity = await json('skill-integrity.json');
assert.equal(cap.version, pkg.version, 'Capability version drift');
assert.equal(skill.version, pkg.version, 'Skill version drift');
assert.equal(integrity.version, pkg.version, 'Skill integrity version drift');
assert.equal(pkg.name, '@petercjl/xhscli');
const actual = {};
async function visit(path) {
  for (const entry of await readdir(new URL(path, root), { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'Bundled resources must be physical files');
    const name = path + entry.name;
    if (entry.isDirectory()) await visit(name + '/');
    else {
      const data = await readFile(new URL(name, root));
      if (path.startsWith('skill/')) actual[name] = createHash('sha256').update(data).digest('hex');
      assert(!/\/Users\/|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/.test(data.toString('utf8')), 'Private content found in ' + name);
    }
  }
}
await visit('skill/');
await visit('src/');
assert.deepEqual(actual, integrity.files, 'Skill integrity drift');
assert(cap.commandContracts.search && cap.commandContracts['note get'], 'Missing business commands');
console.error('Verified package identity, Skill integrity and bundled source.');
