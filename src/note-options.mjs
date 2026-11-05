import { parseArgs } from 'node:util';
import { extname, resolve, parse } from 'node:path';
import { failure } from './browser.mjs';
import { noteLink } from './note-links.mjs';

export function parseNoteUrl(value) {
  let url;
  try { url = new URL(value); } catch {
    throw failure('INVALID_NOTE_URL', 'Provide a Xiaohongshu note URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw failure('INVALID_NOTE_URL', 'Use an HTTPS Xiaohongshu note URL.');
  }
  if (url.hostname === 'xhslink.com' || url.hostname === 'www.xhslink.com') {
    if (!/^\/[a-zA-Z0-9/_-]+$/.test(url.pathname)) throw failure('INVALID_NOTE_URL', 'Invalid share URL.');
    return { noteId: null, url: url.href };
  }
  const match = /^\/(?:explore|search_result|discovery\/item)\/([a-f0-9]{24})\/?$/i.exec(url.pathname);
  if (!['www.xiaohongshu.com', 'xiaohongshu.com'].includes(url.hostname) || !match) {
    throw failure('INVALID_NOTE_URL', 'Provide a Xiaohongshu note URL.');
  }
  const noteId = match[1].toLowerCase();
  return {
    noteId,
    url: noteLink(noteId, url.searchParams.get('xsec_token'), url.searchParams.get('xsec_source') || 'pc_search')
  };
}

export function parseNote(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args, tokens: true,
      options: { id: { type: 'string' }, url: { type: 'string' }, output: { type: 'string' }, json: { type: 'boolean' }, 'download-media': { type: 'boolean' } }
    });
    if (new Set(parsed.tokens.map(token => token.name)).size !== parsed.tokens.length) throw new Error('Duplicate option');
  } catch (error) { throw failure('INVALID_ARGUMENT', error.message); }
  const values = parsed.values;
  if (Boolean(values.id) === Boolean(values.url)) throw failure('INVALID_ARGUMENT', 'Provide exactly one of --id and --url.');
  if (!values.output || extname(values.output).toLowerCase() !== '.json') {
    throw failure('INVALID_ARGUMENT', 'Provide --output FILE.json.');
  }
  let input;
  if (values.url) input = parseNoteUrl(values.url);
  else {
    if (!/^[a-f0-9]{24}$/i.test(values.id)) throw failure('INVALID_ARGUMENT', 'Note IDs must contain 24 hexadecimal characters.');
    const noteId = values.id.toLowerCase();
    input = { noteId, url: null };
  }
  const output = resolve(values.output);
  const { dir, name } = parse(output);
  return {
    ...input, output,
    ...(values['download-media'] ? { downloadMedia: true, mediaDirectory: resolve(dir, name + '.media') } : {})
  };
}
