import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSearch } from '../src/search-options.mjs';

const required = ['--keyword', '午睡枕', '--output', '午睡枕.xlsx'];

test('search defaults to the first page and site defaults', () => {
  const options = parseSearch(required);
  assert.equal(options.keyword, '午睡枕');
  assert.equal(options.startPage, 1);
  assert.equal(options.pages, 1);
  assert.deepEqual(options.selections, []);
});

test('search maps the web filter groups and retains the requested page range', () => {
  const options = parseSearch([...required, '--sort', 'saves', '--note-type', 'video',
    '--published-within', 'half-year', '--scope', 'following', '--distance', 'nearby',
    '--start-page', '2', '--pages', '3', '--page-size', '20']);
  assert.deepEqual(options.selections.map(({ type, tag }) => [type, tag]), [
    ['sort_type', 'collect_descending'], ['filter_note_type', '视频笔记'],
    ['filter_note_time', '半年内'], ['filter_note_range', '已关注'], ['filter_pos_distance', '附近']
  ]);
  assert.equal(options.startPage, 2);
  assert.equal(options.pages, 3);
});

test('search rejects unsupported page sizes and ambiguous or invalid options', () => {
  for (const [args, code] of [
    [['--page-size', '21'], 'UNSUPPORTED_PAGE_SIZE'],
    [['--pages', '0'], 'INVALID_ARGUMENT'],
    [['--sort', 'views'], 'INVALID_ARGUMENT'],
    [['--keyword', '另一个词'], 'INVALID_ARGUMENT'],
    [['--start-page', String(Number.MAX_SAFE_INTEGER), '--pages', '2'], 'INVALID_ARGUMENT']
  ]) {
    assert.throws(() => parseSearch([...required, ...args]), { code });
  }
});
