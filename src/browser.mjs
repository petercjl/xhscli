export const endpoint = 'http://127.0.0.1:9223';
const origin = 'https://www.xiaohongshu.com';
const explore = origin + '/explore';

export function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

async function request(path, method = 'GET') {
  try {
    const response = await fetch(endpoint + path, { method, signal: AbortSignal.timeout(3500) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch {
    throw failure('CDP_UNAVAILABLE', 'Chrome CDP request failed on port 9223.');
  }
}

export async function browserStatus() {
  const info = await request('/json/version');
  if (!/^Chrome\//.test(info?.Browser ?? '') || !info['Protocol-Version']) {
    throw failure('CDP_UNEXPECTED_BROWSER', 'Port 9223 did not identify itself as Chrome CDP.');
  }
  return { endpoint, browser: info.Browser, protocolVersion: info['Protocol-Version'] };
}

function isXhs(url) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

async function findPage() {
  const targets = await request('/json/list');
  if (!Array.isArray(targets)) throw failure('CDP_INVALID_TARGETS', 'Invalid Chrome target list.');
  return targets.find(target => target.type === 'page' && target.url === explore)
    ?? targets.find(target => target.type === 'page' && isXhs(target.url));
}

export async function openSite() {
  await browserStatus();
  const existing = await findPage();
  if (existing) {
    try {
      const response = await fetch(endpoint + '/json/activate/' + encodeURIComponent(existing.id), {
        signal: AbortSignal.timeout(3500)
      });
      if (!response.ok) throw new Error();
    } catch {
      throw failure('TAB_ACTIVATION_FAILED', 'Could not activate the Xiaohongshu tab.');
    }
    return { targetId: existing.id, reused: true };
  }
  const target = await request('/json/new?' + explore, 'PUT');
  if (!target?.id) throw failure('TAB_OPEN_FAILED', 'Chrome did not return a new tab ID.');
  return { targetId: target.id, reused: false };
}

function readPage() {
  const visible = element => element.getClientRects().length > 0
    && getComputedStyle(element).visibility === 'visible';
  const login = [...document.querySelectorAll('button, a, [role="button"]')]
    .some(element => visible(element) && /^(登录|立即登录|登录小红书)$/.test(element.innerText?.trim())
      && Boolean(element.closest('nav, aside, header, [role="dialog"], [class*="login"], [class*="side-bar"]')));
  const profile = [...document.querySelectorAll('a[href^="/user/profile/"]')]
    .some(element => visible(element) && /^(我|我的)$/.test(element.innerText?.trim())
      && Boolean(element.closest('nav, aside, header, [class*="side-bar"], [class*="sidebar"]')));
  const verification = /安全验证|请完成验证|滑动验证/.test(document.body?.innerText.slice(0, 1500) ?? '');
  return { origin: location.origin, path: location.pathname, login, profile, verification };
}

function evaluate(target) {
  const expected = 'ws://127.0.0.1:9223/devtools/page/' + target.id;
  if (target.webSocketDebuggerUrl !== expected) {
    throw failure('CDP_INVALID_TARGET', 'Chrome returned an unexpected target websocket address.');
  }
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(expected);
    const abort = () => finish(failure('PAGE_INSPECTION_FAILED', 'Could not inspect the Chrome tab.'));
    const timer = setTimeout(abort, 3500);
    function finish(error, result) {
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(result);
    }
    socket.addEventListener('error', abort, { once: true });
    socket.addEventListener('close', abort, { once: true });
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression: '(' + readPage.toString() + ')()', returnByValue: true }
    })), { once: true });
    socket.addEventListener('message', event => {
      const reply = JSON.parse(event.data);
      if (reply.id !== 1) return;
      const result = reply.result?.result?.value;
      if (!result) abort();
      else finish(null, result);
    });
  });
}

export function classify(signals) {
  if (signals.origin !== origin) return { state: 'unknown', evidence: 'unexpected_origin' };
  if (signals.verification) return { state: 'verification_required', evidence: 'verification_prompt' };
  if (/^\/login(?:\/|$)/.test(signals.path)) return { state: 'login_required', evidence: 'login_route' };
  if (signals.login && signals.profile) return { state: 'unknown', evidence: 'conflicting_signals' };
  if (signals.login) return { state: 'login_required', evidence: 'visible_login_control' };
  if (signals.profile) return { state: 'logged_in', evidence: 'visible_self_profile_navigation' };
  return { state: 'unknown', evidence: 'no_conclusive_signal' };
}

export async function authStatus() {
  await browserStatus();
  const target = await findPage();
  if (!target) throw failure('XHS_TAB_MISSING', 'Run xhscli browser open first.');
  return classify(await evaluate(target));
}
