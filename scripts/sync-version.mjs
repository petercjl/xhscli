import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const pkg = await read('package.json');
const cap = await read('capabilities.json');
cap.version = pkg.version;
await writeFile(new URL('capabilities.json', root), JSON.stringify(cap, null, 2) + '\n');
await writeFile(new URL('skill/xhscli/package.json', root), JSON.stringify({ name: 'xhscli', version: pkg.version }, null, 2) + '\n');
const files = {};
async function visit(path) {
  for (const entry of await readdir(new URL(path, root), { withFileTypes: true })) {
    const name = path + entry.name;
    if (entry.isDirectory()) await visit(name + '/');
    else files[name] = createHash('sha256').update(await readFile(new URL(name, root))).digest('hex');
  }
}
await visit('skill/');
await writeFile(new URL('skill-integrity.json', root), JSON.stringify({ version: pkg.version, files }, null, 2) + '\n');
