import { link, lstat, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { failure } from './browser.mjs';

export async function checkOutput(output) {
  if (!(await stat(dirname(output)).catch(() => null))?.isDirectory()) {
    throw failure('OUTPUT_PARENT_MISSING', 'The output folder must already exist.');
  }
  try {
    await lstat(output);
    throw failure('OUTPUT_EXISTS', 'Choose a new output file path.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function writeOutput(output, content) {
  const directory = await mkdtemp(join(dirname(output), '.xhscli-'));
  try {
    const temporary = join(directory, 'output');
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await link(temporary, output).catch(error => {
      if (error.code === 'EEXIST') throw failure('OUTPUT_EXISTS', 'Choose a new output file path.');
      throw error;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
