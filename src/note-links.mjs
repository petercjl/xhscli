import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const cache = () => join(homedir(), '.cache', 'xhscli', 'note-links');

export function noteLink(id, token, source = 'pc_search') {
  const url = new URL('https://www.xiaohongshu.com/explore/' + id);
  if (token) {
    url.searchParams.set('xsec_token', token);
    url.searchParams.set('xsec_source', source);
  }
  return url.href;
}

export async function rememberLinks(items) {
  const records = items.filter(item => /^[a-f0-9]{24}$/i.test(item.id) && item.xsec_token)
    .map(item => ({ id: item.id.toLowerCase(), url: noteLink(item.id, item.xsec_token) }));
  if (!records.length) return;
  await mkdir(cache(), { recursive: true, mode: 0o700 });
  const name = Date.now() + '-' + randomUUID() + '.json';
  await writeFile(join(cache(), name), JSON.stringify(records), { flag: 'wx', mode: 0o600 });
}

export async function cachedLink(id) {
  let files;
  try { files = await readdir(cache()); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  for (const file of files.filter(name => /^\d+-[a-f0-9-]+\.json$/.test(name)).sort().reverse()) {
    let records;
    try { records = JSON.parse(await readFile(join(cache(), file), 'utf8')); } catch { continue; }
    if (!Array.isArray(records)) continue;
    const record = records.find(record => record.id === id && typeof record.url === 'string');
    if (record) return record.url;
  }
  return null;
}
