import { failure } from './browser.mjs';

export async function connect(id) {
  const ws = new WebSocket('ws://127.0.0.1:9223/devtools/page/' + id);
  let onEvent;
  const pending = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(failure('CDP_CONNECT_FAILED', 'Timed out attaching to Chrome.'));
      ws.close();
    }, 5000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(failure('CDP_CONNECT_FAILED', 'Could not attach to Chrome.'));
    }, { once: true });
  });
  ws.addEventListener('message', ({ data }) => {
    const reply = JSON.parse(data);
    if (reply.id) pending.get(reply.id)?.(reply);
    else onEvent?.(reply);
  });
  return {
    close: () => ws.close(),
    events: handler => { onEvent = handler; },
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(failure('CDP_TIMEOUT', method + ' timed out.'));
        }, 12000);
        pending.set(id, reply => {
          clearTimeout(timer);
          pending.delete(id);
          if (reply.error) reject(failure('CDP_COMMAND_FAILED', method + ' failed.'));
          else resolve(reply.result);
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }
  };
}
