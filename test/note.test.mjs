import assert from 'node:assert/strict';
import test from 'node:test';
import { Comments } from '../src/comments.mjs';
import { parseNote, parseNoteUrl } from '../src/note-options.mjs';

const id = '6aeb1dda000000000f02401f';
const page = (comments, has_more, cursor = '') => ({ success: true, data: { comments, has_more, cursor } });
const root = (commentId, hasMore = false) => ({
  id: commentId, note_id: id, sub_comment_has_more: hasMore, sub_comments: [{ id: 'inline-reply' }],
  sub_comment_cursor: 'first'
});

test('note links preserve the access token and canonicalize the route', () => {
  const result = parseNoteUrl('https://www.xiaohongshu.com/discovery/item/' + id + '?xsec_token=a%2Bb%3D&xsec_source=pc_search');
  assert.equal(result.noteId, id);
  assert.equal(new URL(result.url).pathname, '/explore/' + id);
  assert.equal(new URL(result.url).searchParams.get('xsec_token'), 'a+b=');
});

test('note parser rejects foreign hosts, non-note paths, duplicate inputs and missing output', () => {
  for (const url of [
    'https://www.xiaohongshu.com.evil.example/explore/' + id,
    'https://evil.example/explore/' + id,
    'https://user:password@www.xiaohongshu.com/explore/' + id,
    'https://www.xiaohongshu.com/search_result?keyword=test'
  ]) assert.throws(() => parseNoteUrl(url), { code: 'INVALID_NOTE_URL' });
  assert.throws(() => parseNote(['--id', id]), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseNote(['--id', id, '--id', id, '--output', 'test.json']), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseNote(['--id', id, '--url', 'https://xhslink.com/a/demo', '--output', 'test.json']), { code: 'INVALID_ARGUMENT' });
});

test('comment completion requires both top-level and reply pagination to end', () => {
  const comments = new Comments();
  comments.add('top', '', null, page([root('parent', true)], true, 'page2'), id);
  assert.equal(comments.complete, false);
  comments.add('top', 'page2', null, page([root('parent'), root('second')], false), id);
  assert.equal(comments.complete, false);
  assert.equal(comments.pendingReply(), 'parent');
  comments.add('sub', 'first', 'parent', page([{ id: 'inline-reply' }, { id: 'second-reply', note_id: id }], false), id);
  assert.equal(comments.complete, true);
  assert.equal(comments.serialize().length, 2);
  assert.equal(comments.serialize()[0].sub_comments.length, 2);
  assert.equal(comments.serialize()[0].sub_comment_has_more, false);
});

test('comment cursor stalls and malformed replies do not claim completion', () => {
  const comments = new Comments();
  assert.throws(() => comments.add('top', 'same', null, page([], true, 'same'), id), { code: 'COMMENT_CURSOR_STALLED' });
  assert.throws(() => comments.add('sub', '', 'missing', page([], false), id), { code: 'COMMENT_PARENT_MISSING' });
  assert.equal(comments.complete, false);
});

test('an empty completed comment page is complete', () => {
  const comments = new Comments();
  comments.add('top', '', null, page([], false), id);
  assert.equal(comments.complete, true);
});
