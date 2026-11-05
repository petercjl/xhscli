import { failure } from './browser.mjs';

export class Comments {
  roots = new Map();
  topEnded = false;
  topCursor = null;
  topSeen = false;
  pages = [];
  seenPages = new Set();

  add(kind, cursor, rootId, response, noteId) {
    const pageKey = JSON.stringify([kind, rootId, cursor]);
    if (this.seenPages.has(pageKey)) throw failure('COMMENT_CURSOR_STALLED', 'A comment pagination request repeated.');
    const data = response?.data;
    if (response?.success !== true || !Array.isArray(data?.comments) || typeof data.has_more !== 'boolean') {
      throw failure('COMMENT_RESPONSE_INVALID', 'The platform did not return a successful comment page.');
    }
    if (data.has_more && (!data.cursor || data.cursor === cursor)) {
      throw failure('COMMENT_CURSOR_STALLED', 'The comment pagination cursor did not advance.');
    }
    for (const comment of data.comments) {
      if (typeof comment?.id !== 'string' || (comment.note_id && comment.note_id !== noteId)) {
        throw failure('COMMENT_RESPONSE_INVALID', 'The comment page did not match the requested note.');
      }
    }
    if (kind === 'top') {
      for (const comment of data.comments) {
        if (typeof comment.sub_comment_has_more !== 'boolean' || !Array.isArray(comment.sub_comments)) {
          throw failure('COMMENT_RESPONSE_INVALID', 'A comment omitted its reply pagination state.');
        }
        if (comment.sub_comments.some(reply => typeof reply?.id !== 'string' || (reply.note_id && reply.note_id !== noteId))) {
          throw failure('COMMENT_RESPONSE_INVALID', 'A reply did not match the requested note.');
        }
        const previous = this.roots.get(comment.id);
        if (previous) continue;
        this.roots.set(comment.id, {
          raw: { ...comment },
          replies: new Map(comment.sub_comments.map(reply => [reply.id, reply])),
          hasMore: comment.sub_comment_has_more,
          cursor: comment.sub_comment_cursor
        });
      }
      this.topSeen = true;
      this.topEnded = !data.has_more;
      this.topCursor = data.cursor;
    } else {
      const root = this.roots.get(rootId);
      if (!root) throw failure('COMMENT_PARENT_MISSING', 'A reply page has no matching parent comment.');
      for (const comment of data.comments) root.replies.set(comment.id, comment);
      root.hasMore = data.has_more;
      root.cursor = data.cursor;
    }
    this.seenPages.add(pageKey);
    this.pages.push({ kind, requestCursor: cursor, rootCommentId: rootId, response });
  }

  pendingReply() {
    return [...this.roots].find(([, root]) => root.hasMore)?.[0];
  }

  get complete() {
    return this.topSeen && this.topEnded && !this.pendingReply();
  }

  serialize() {
    return [...this.roots.values()].map(root => ({
      ...root.raw, sub_comments: [...root.replies.values()],
      sub_comment_has_more: root.hasMore, sub_comment_cursor: root.cursor
    }));
  }
}
