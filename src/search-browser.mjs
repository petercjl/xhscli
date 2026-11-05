import { connect } from './cdp.mjs';
import { randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { browserStatus, endpoint, failure } from './browser.mjs';

const notesUrls = [
  'https://so.xiaohongshu.com/api/sns/web/v2/search/notes',
  'https://edith.xiaohongshu.com/api/sns/web/v1/search/notes'
];


function filterPosition() {
  const rect = document.querySelector('.search-layout__top .filter')?.getBoundingClientRect();
  return rect?.width ? [rect.x + rect.width / 2, rect.y + rect.height / 2] : null;
}

function selectFilter(group, label) {
  const section = [...document.querySelectorAll('.filter-panel .filters')]
    .find(element => element.firstElementChild?.textContent.trim() === group);
  const tag = [...(section?.querySelectorAll('.tags:not([aria-hidden="true"])') ?? [])]
    .find(element => element.textContent.trim() === label && element.getClientRects().length);
  if (!tag) return false;
  tag.click();
  return true;
}

function pageBlocker() {
  if (/^\/login(?:\/|$)/.test(location.pathname)
    || document.querySelector('.login-container')?.getClientRects().length) return 'LOGIN_REQUIRED';
  if (/安全验证|请完成验证|滑动验证/.test(document.body?.innerText.slice(0, 600) ?? '')) {
    return 'VERIFICATION_REQUIRED';
  }
  return null;
}

async function runSearch(cdp, { keyword, selections, pages, startPage }) {
  const queued = new Map();
  const responses = new Map();
  const requestIntervalsMs = [];
  const requestWaitsMs = [];
  let lastSent;
  let fault;
  cdp.events(({ method, params }) => {
    if (method !== 'Fetch.requestPaused') return;
    if (params.responseStatusCode || params.responseErrorReason) {
      responses.set(params.requestId, params);
      return;
    }
    let body;
    try { body = JSON.parse(params.request.postData); } catch {}
    if (params.request.method === 'POST' && body?.keyword === keyword) {
      queued.set(params.requestId, body);
    } else {
      const method = params.request.method === 'OPTIONS' ? 'Fetch.continueRequest' : 'Fetch.failRequest';
      const error = method === 'Fetch.failRequest' ? { errorReason: 'Aborted' } : {};
      cdp.call(method, { requestId: params.requestId, ...error }).catch(e => { fault = e; });
    }
  });
  const evaluate = async (fn, ...args) => {
    const r = await cdp.call('Runtime.evaluate', {
      expression: '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')',
      returnByValue: true, awaitPromise: true
    });
    return r.result?.value;
  };
  async function waitFor(probe, code, message) {
    const deadline = performance.now() + 14000;
    do {
      if (fault) throw fault;
      const result = await probe();
      if (result) return result;
      await sleep(100);
    } while (performance.now() < deadline);
    const blocker = await evaluate(pageBlocker);
    if (blocker) throw failure(blocker, 'Complete sign-in or verification in Chrome and retry.');
    throw failure(code, message);
  }
  const active = [];
  async function readPage(page) {
    const [requestId, body] = await waitFor(() => [...queued].find(([, b]) =>
      b.page === page && active.every(({ type, tag }) =>
        b.filters?.some(f => f.type === type && f.tags?.includes(tag)))),
      'SEARCH_REQUEST_MISSING', 'Chrome did not request the expected search page ' + page + '.');
    queued.delete(requestId);
    if (body.page_size !== 20) throw failure('PAGE_SIZE_CHANGED', 'The website changed its search page size.');
    if (lastSent !== undefined) {
      const wait = randomInt(2000, 3001);
      requestWaitsMs.push(wait);
      await sleep(wait);
    }
    const sent = performance.now();
    if (lastSent !== undefined) requestIntervalsMs.push(Math.round(sent - lastSent));
    lastSent = sent;
    await cdp.call('Fetch.continueRequest', { requestId, interceptResponse: true });
    const response = await waitFor(() => responses.get(requestId), 'SEARCH_RESPONSE_MISSING', 'No search response from Chrome.');
    responses.delete(requestId);
    if (response.responseErrorReason || response.responseStatusCode !== 200) {
      throw failure('SEARCH_HTTP_ERROR', 'Search returned HTTP ' + (response.responseStatusCode ?? 'error') + '.');
    }
    const result = await cdp.call('Fetch.getResponseBody', { requestId });
    const raw = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
    await cdp.call('Fetch.continueResponse', { requestId });
    let data;
    try { data = JSON.parse(raw); } catch {}
    if (data?.success !== true || !Array.isArray(data.data?.items) || typeof data.data.has_more !== 'boolean') {
      throw failure('SEARCH_REJECTED', 'Search did not return a successful result list. Platform code: ' + (Number(data?.code) || 0));
    }
    return data.data;
  }

  await cdp.call('Fetch.enable', { patterns: notesUrls.map(url => ({ urlPattern: url + '*', requestStage: 'Request' })) });
  await cdp.call('Page.navigate', {
    url: 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(keyword) + '&source=web_explore_feed'
  });
  let data = await readPage(1);
  for (const selection of selections) {
    const [x, y] = await waitFor(() => evaluate(filterPosition), 'FILTER_UNAVAILABLE', 'Search filter panel is unavailable.');
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await waitFor(() => evaluate(selectFilter, selection.group, selection.label),
      'FILTER_UNAVAILABLE', 'Could not select ' + selection.label + '.');
    active.push(selection);
    try {
      data = await readPage(1);
    } catch (error) {
      if (selection.type === 'filter_pos_distance' && error.code === 'SEARCH_REQUEST_MISSING') {
        const permission = await evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state);
        if (permission !== 'granted') {
          throw failure('LOCATION_PERMISSION_REQUIRED', 'Allow location for Xiaohongshu in Chrome and retry the distance filter.');
        }
        throw failure('LOCATION_UNAVAILABLE', 'The website could not apply the selected distance filter.');
      }
      throw error;
    }
  }

  const results = [];
  const endPage = startPage + (pages - 1);
  for (let page = 1; page <= endPage; page++) {
    if (page >= startPage) results.push({ page, ...data });
    if (page === endPage || !data.has_more) break;
    await evaluate(() => {
      const notes = document.querySelectorAll('section.note-item');
      notes[notes.length - 1]?.scrollIntoView({ block: 'end' });
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    const scrolling = setInterval(() => {
      evaluate(() => {
        const notes = document.querySelectorAll('section.note-item');
        notes[notes.length - 1]?.scrollIntoView({ block: 'end' });
      }).catch(() => {});
    }, 500);
    try { data = await readPage(page + 1); } finally { clearInterval(scrolling); }
  }
  return { results, requestWaitsMs, requestIntervalsMs };
}

export async function searchBrowser(options) {
  await browserStatus();
  const response = await fetch(endpoint + '/json/new?about:blank', {
    method: 'PUT', signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw failure('TAB_OPEN_FAILED', 'Could not open the search tab.');
  const { id } = await response.json();
  if (typeof id !== 'string' || !/^[a-f0-9]+$/i.test(id)) {
    throw failure('TAB_OPEN_FAILED', 'Chrome did not return a valid search tab ID.');
  }
  let cdp;
  let keepOpen = false;
  try {
    cdp = await connect(id);
    return await runSearch(cdp, options);
  } catch (error) {
    keepOpen = ['LOGIN_REQUIRED', 'VERIFICATION_REQUIRED'].includes(error.code);
    throw error;
  } finally {
    if (keepOpen && cdp) {
      await cdp.call('Fetch.disable').catch(() => {});
    } else {
      await fetch(endpoint + '/json/close/' + id, { signal: AbortSignal.timeout(5000) }).catch(() => {});
    }
    cdp?.close();
  }
}
