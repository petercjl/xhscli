import assert from 'node:assert/strict';
import test from 'node:test';
import { classify } from '../src/browser.mjs';

const explore = { origin: 'https://www.xiaohongshu.com', path: '/explore' };
const cases = [
  [{ profile: true }, 'logged_in'],
  [{ login: true }, 'login_required'],
  [{ path: '/login' }, 'login_required'],
  [{ login: true, verification: true }, 'verification_required'],
  [{ profile: true, login: true }, 'unknown'],
  [{ origin: 'https://example.com', profile: true }, 'unknown'],
  [{}, 'unknown']
];

for (const [signals, state] of cases) {
  test(JSON.stringify(signals) + ' yields ' + state, () => {
    assert.equal(classify({ ...explore, ...signals }).state, state);
  });
}
