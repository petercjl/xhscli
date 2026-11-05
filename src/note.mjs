import { randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { browserStatus, endpoint, failure } from './browser.mjs';
import { connect } from './cdp.mjs';
import { Comments } from './comments.mjs';
import { cachedLink, noteLink, rememberLinks } from './note-links.mjs';
import { parseNoteUrl } from './note-options.mjs';
import { checkOutput, writeOutput } from './output.mjs';

async function evaluate(cdp, fn, ...args) {
  const result = await cdp.call('Runtime.evaluate', {
    expression: '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')',
    returnByValue: true, awaitPromise: true
  });
  if (result.exceptionDetails) throw failure('PAGE_INSPECTION_FAILED', 'Could not read the note page.');
  return result.result?.value;
}

async function scrollComments() {
  const scroller = document.querySelector('.note-scroller');
  if (!scroller) return;
  scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 600);
  await new Promise(resolve => setTimeout(resolve, 150));
  scroller.scrollTop = scroller.scrollHeight;
}

function currentNote(id) {
  const unwrap = value => value?.__v_isRef ? value.value ?? value._value : value;
  const note = unwrap(window.__INITIAL_STATE__?.note?.noteDetailMap)?.[id]?.note;
  if (note?.noteId !== id) return null;
  return JSON.parse(JSON.stringify(note));
}

async function resolveLink(noteId) {
  const cached = await cachedLink(noteId);
  if (cached) {
    try { return parseNoteUrl(cached).url; } catch {}
  }
  const tabs = await (await fetch(endpoint + '/json/list', { signal: AbortSignal.timeout(3500) })).json();
  for (const tab of tabs) {
    if (tab.type !== 'page' || !tab.url.startsWith('https://www.xiaohongshu.com/')) continue;
    if (!/^[a-f0-9]+$/i.test(tab.id)) continue;
    const cdp = await connect(tab.id);
    try {
      const link = await evaluate(cdp, id => {
        const valid = href => {
          try {
            const u = new URL(href, location.origin);
            return u.origin === location.origin && u.pathname.endsWith('/' + id) && u.searchParams.has('xsec_token');
          } catch { return false; }
        };
        if (valid(location.href)) return location.href;
        const anchor = [...document.querySelectorAll('a[href]')].find(a => valid(a.href));
        if (anchor) return anchor.href;
        const state = window.__INITIAL_STATE__?.note?.noteDetailMap;
        const map = state?.__v_isRef ? state.value ?? state._value : state;
        const token = map?.[id]?.note?.xsecToken;
        if (token) {
          const u = new URL('/explore/' + id, location.origin);
          u.searchParams.set('xsec_token', token);
          u.searchParams.set('xsec_source', 'pc_search');
          return u.href;
        }
        return null;
      }, noteId);
      if (link) return parseNoteUrl(link).url;
    } finally { cdp.close(); }
  }
  return noteLink(noteId);
}

async function collect(cdp, url, requestedId) {
  const comments = new Comments();
  const waits = [];
  const queue = [];
  const responses = new Map();
  let fault;
  let worker = Promise.resolve();
  let lastSent;
  let stopped = false;
  let noteId = requestedId;
  let note;
  const feedResponses = [];

  async function handle(params) {
    if (stopped) return;
    const u = new URL(params.request.url);
    if (lastSent !== undefined) {
      const wait = randomInt(2000, 3001);
      waits.push(wait);
      await sleep(wait);
    }
    lastSent = performance.now();
    await cdp.call('Fetch.continueRequest', { requestId: params.requestId, interceptResponse: true });
    const deadline = performance.now() + 14000;
    while (!responses.has(params.requestId)) {
      if (performance.now() > deadline) throw failure('NOTE_RESPONSE_TIMEOUT', 'A note request did not finish.');
      if (stopped) return;
      await sleep(100);
    }
    const reply = responses.get(params.requestId);
    responses.delete(params.requestId);
    if (reply.responseStatusCode !== 200) throw failure('NOTE_HTTP_ERROR', 'The platform returned HTTP ' + reply.responseStatusCode + '.');
    const body = await cdp.call('Fetch.getResponseBody', { requestId: params.requestId });
    await cdp.call('Fetch.continueResponse', { requestId: params.requestId });
    let response;
    try { response = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body); } catch {}
    if (response?.success !== true) throw failure('NOTE_REQUEST_REJECTED', 'The platform rejected a note request.');
    if (u.pathname.endsWith('/feed')) {
      feedResponses.push(response);
    } else {
      const responseNote = u.searchParams.get('note_id');
      if (!noteId) noteId = responseNote;
      if (responseNote !== noteId) throw failure('NOTE_ID_MISMATCH', 'Comments did not match the requested note.');
      comments.add(u.pathname.endsWith('/sub/page') ? 'sub' : 'top',
        u.searchParams.get('cursor') || '', u.searchParams.get('root_comment_id'), response, noteId);
    }
  }
  cdp.events(({ method, params }) => {
    if (method !== 'Fetch.requestPaused') return;
    if (params.responseStatusCode || params.responseErrorReason) {
      responses.set(params.requestId, params);
    } else if (params.request.method === 'OPTIONS') {
      cdp.call('Fetch.continueRequest', { requestId: params.requestId }).catch(error => { fault = error; });
    } else {
      queue.push(params.requestId);
      worker = worker.then(async () => {
        try { await handle(params); } finally { queue.splice(queue.indexOf(params.requestId), 1); }
      }).catch(error => { fault = error; stopped = true; });
    }
  });
  const patterns = [
    'https://edith.xiaohongshu.com/api/sns/web/v2/comment/*',
    'https://edith.xiaohongshu.com/api/sns/web/v1/feed',
    'https://so.xiaohongshu.com/api/sns/web/v2/comment/*'
  ].map(urlPattern => ({ urlPattern, requestStage: 'Request' }));
  await cdp.call('Fetch.enable', { patterns });
  await cdp.call('Page.navigate', { url });

  async function waitFor(probe) {
    const deadline = performance.now() + 22000;
    do {
      if (fault) throw fault;
      const value = await probe();
      if (value) return value;
      await sleep(150);
    } while (performance.now() < deadline);
    const blocker = await evaluate(cdp, () => {
      if (/^\/login(?:\/|$)/.test(location.pathname) || document.querySelector('.login-container')?.getClientRects().length) return 'LOGIN_REQUIRED';
      if (/安全验证|请完成验证|滑动验证/.test(document.body?.innerText.slice(0, 600) ?? '')) return 'VERIFICATION_REQUIRED';
      return null;
    });
    throw failure(blocker || 'NOTE_LOAD_STALLED', 'The note or its comments could not finish loading. Use a current note link and complete any browser verification.');
  }

  try {
    const location = await waitFor(async () => {
      const location = await evaluate(cdp, () => window.location.href);
      try {
        const parsed = parseNoteUrl(location);
        return parsed.noteId ? parsed : null;
      } catch { return null; }
    });
    if (noteId && location.noteId !== noteId) throw failure('NOTE_ID_MISMATCH', 'The page opened a different note.');
    noteId = location.noteId;
    note = await waitFor(() => evaluate(cdp, currentNote, noteId));
    await waitFor(() => comments.topSeen);
    while (!comments.complete) {
      const before = comments.pages.length;
      const rootId = comments.pendingReply();
      if (rootId) {
        await waitFor(() => evaluate(cdp, (id, expectedCursor, noteId) => {
          const ref = window.__INITIAL_STATE__?.note?.noteDetailMap;
          const map = ref?.__v_isRef ? ref.value ?? ref._value : ref;
          const root = map?.[noteId]?.comments?.list?.find(item => item.id === id);
          if (!root || root.subCommentCursor !== expectedCursor) return false;
          const comment = document.getElementById('comment-' + id);
          const button = comment?.closest('.parent-comment')?.querySelector('.show-more');
          if (!button) return false;
          button.scrollIntoView({ block: 'center' });
          button.click();
          return true;
        }, rootId, comments.roots.get(rootId).cursor, noteId));
      } else {
        await evaluate(cdp, scrollComments);
      }
      await waitFor(async () => {
        if (comments.pages.length > before) return true;
        if (!rootId) await evaluate(cdp, scrollComments);
        return false;
      });
    }
    await worker;
    if (fault) throw fault;
    return { noteId, note, comments, waits, feedResponses, error: null };
  } catch (error) {
    if (!note) throw error;
    return { noteId, note, comments, waits, feedResponses, error };
  } finally { stopped = true; }
}

export async function noteGet(options) {
  await checkOutput(options.output);
  await browserStatus();
  const url = options.url || await resolveLink(options.noteId);
  const response = await fetch(endpoint + '/json/new?about:blank', { method: 'PUT', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw failure('TAB_OPEN_FAILED', 'Could not open a note tab.');
  const { id } = await response.json();
  if (typeof id !== 'string' || !/^[a-f0-9]+$/i.test(id)) throw failure('TAB_OPEN_FAILED', 'Chrome returned an invalid note tab ID.');
  let cdp;
  let result;
  try {
    cdp = await connect(id);
    result = await collect(cdp, url, options.noteId);
  } finally {
    await fetch(endpoint + '/json/close/' + id, { signal: AbortSignal.timeout(5000) }).catch(() => {});
    cdp?.close();
  }
  const { noteId, note, comments, waits, feedResponses, error } = result;
  const complete = comments.complete && !error;
  const document = {
    schemaVersion: 1, capturedAt: new Date().toISOString(), noteId,
    noteUrl: noteLink(noteId, note.xsecToken || new URL(url).searchParams.get('xsec_token')),
    note, comments: comments.serialize(),
    completeness: {
      complete, topLevelPaginationEnded: comments.topEnded,
      pendingReplyThreads: [...comments.roots].filter(([, root]) => root.hasMore).map(([id]) => id),
      failure: error ? { code: error.code, message: error.message } : null,
      scope: 'All comments and replies returned to the current web session at capture time'
    },
    source: { note: 'page.__INITIAL_STATE__.note.noteDetailMap', commentPages: comments.pages, feedResponses },
    requestWaitsMs: waits
  };
  await writeOutput(options.output, JSON.stringify(document, null, 2) + '\n');
  await rememberLinks([{ id: noteId, xsec_token: note.xsecToken }]).catch(() => {});
  const replyCount = document.comments.reduce((sum, root) => sum + root.sub_comments.length, 0);
  return {
    ok: complete, noteId, output: options.output, complete,
    topLevelComments: document.comments.length, replies: replyCount, requestWaitsMs: waits,
    ...(error ? { code: error.code, message: error.message } : {})
  };
}
