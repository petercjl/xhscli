#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { autoDetect, runMaintenance } from './package-runtime.mjs';
import { authStatus, browserStatus, failure, openSite } from './browser.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const pkg = read('../package.json');
const config = {
  root: fileURLToPath(new URL('..', import.meta.url)),
  name: pkg.name, version: pkg.version, tool: 'xhscli', skills: ['xhscli'],
  entry: 'src/cli.mjs', targetEnvironment: 'XHSCLI_SKILL_TARGET',
  runtimeItems: ['package.json', ...pkg.files, 'README.md']
};
const manifest = () => read('../capabilities.json');
const commands = {
  version: () => ({ package: pkg.name, version: pkg.version }),
  capabilities: manifest,
  doctor: async () => ({ node: process.version, ...await browserStatus() }),
  'browser status': browserStatus,
  'browser open': openSite,
  'auth status': authStatus
};

const args = process.argv.slice(2);
const searching = args[0] === 'search';
const gettingNote = args[0] === 'note' && args[1] === 'get';
const maintenance = ['skill', 'update', 'operation'].includes(args[0]);
const json = searching || gettingNote ? args.includes('--json') : args.at(-1) === '--json';
if (json && !maintenance && !searching && !gettingNote) args.pop();
const command = args.join(' ');
if (!command || ['--help', 'help'].includes(command)) {
  if (json) console.log(JSON.stringify({ ok: true, ...manifest() }));
  else console.log('xhscli <' + Object.keys(commands).join(' | ') + ' | search | note get | skill <source|status|install|update> | update <check|install|recover>> [--json]');
} else {
  try {
    if (maintenance) {
      await runMaintenance(config, args[0], args.slice(1));
    } else if (gettingNote) {
      if (args.length === 3 && args[2] === '--help') {
        console.log(JSON.stringify(manifest().commandContracts['note get'], null, 2));
      } else {
        const { parseNote } = await import('./note-options.mjs');
        const { noteGet } = await import('./note.mjs');
        const options = parseNote(args.slice(2));
        await autoDetect(config).catch(() => {});
        const result = await noteGet(options);
        console.log(JSON.stringify(result, null, json ? 0 : 2));
        if (!result.ok) process.exitCode = 1;
      }
    } else if (searching) {
      if (args.length === 2 && args[1] === '--help') {
        console.log(JSON.stringify(manifest().commandContracts.search, null, 2));
      } else {
        const { parseSearch } = await import('./search-options.mjs');
        const options = parseSearch(args.slice(1));
        const { search } = await import('./search.mjs');
        await autoDetect(config).catch(() => {});
        console.log(JSON.stringify({ ok: true, ...await search(options) }, null, json ? 0 : 2));
      }
    } else {
      const handler = command === '--version' ? commands.version
        : Object.hasOwn(commands, command) ? commands[command] : null;
      if (!handler) throw failure('UNKNOWN_COMMAND', 'Use xhscli --help for supported commands.');
      if (command === 'auth status' || command === 'browser open') {
        await autoDetect(config).catch(() => {});
      }
      const result = await handler();
      if (!json && (command === 'version' || command === '--version')) console.log(pkg.version);
      else console.log(JSON.stringify({ ok: true, ...result }, null, json ? 0 : 2));
    }
  } catch (error) {
    const result = { ok: false, code: error.code ?? 'INTERNAL_ERROR', message: error.message };
    (json ? console.log : console.error)(JSON.stringify(result));
    process.exitCode = 1;
  }
}
