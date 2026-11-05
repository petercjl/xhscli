import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadMedia, mediaUrl, planMedia } from '../src/media.mjs';
import { parseNote } from '../src/note-options.mjs';

const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const host = 'https://sns-webpic-qc.xhscdn.com/';
const picture = name => ({ urlDefault: host + name });

test('media downloads are opt-in and use a directory next to the JSON', () => {
  const args = ['--id', '0123456789abcdef01234567', '--output', 'sample.JSON'];
  assert.equal(parseNote(args).downloadMedia, undefined);
  const parsed = parseNote([...args, '--download-media']);
  assert.equal(parsed.downloadMedia, true);
  assert.match(parsed.mediaDirectory, /sample\.media$/);
});

test('media URLs retain access parameters and reject unrelated destinations', () => {
  assert.equal(mediaUrl(host + 'image?token=fixture'), host + 'image?token=fixture');
  for (const url of ['file:///etc/passwd', 'https://127.0.0.1/x', 'https://xhscdn.com.evil.example/x', 'https://user:pass@sns.xhscdn.com/x']) assert.equal(mediaUrl(url), null);
});

test('actual video stream group names and live photos are selected from supplied URLs', () => {
  const video = { type: 'video', imageList: [picture('cover')], video: { media: { stream: { EF4: [
    { width: 640, height: 480, masterUrl: 'https://sns-video-v6.xhscdn.com/small.mp4' },
    { width: 1920, height: 1080, masterUrl: 'https://sns-video-v6.xhscdn.com/large.mp4' }
  ] } } } };
  const assets = planMedia(video);
  assert.equal(assets.length, 2);
  assert.equal(assets[0].role, 'cover');
  assert.match(assets[1].urls[0], /large\.mp4$/);
  const live = planMedia({ type: 'normal', imageList: [{ ...picture('live'), livePhoto: true, stream: video.video.media.stream }] });
  assert.equal(live[1].role, 'live-photo');
});

test('partial downloads preserve valid files and report per-asset failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xhscli-media-test-'));
  const directory = join(root, 'sample.media');
  const requests = [];
  const result = await downloadMedia({ type: 'normal', imageList: [picture('valid'), picture('denied')] }, directory, {
    fetchImpl: async url => {
      requests.push(url);
      return url.endsWith('valid') ? new Response(image, { headers: { 'content-type': 'image/jpeg', 'content-length': String(image.length) } }) : new Response('denied', { status: 403 });
    }
  });
  assert.equal(result.complete, false);
  assert.equal(result.files[0].bytes, image.length);
  assert.equal(result.files[1].status, 'failed');
  assert.equal(result.files[1].error.code, 'MEDIA_HTTP_ERROR');
  assert.deepEqual(await readFile(join(directory, 'image-001.jpg')), image);
  assert.deepEqual(await readdir(directory), ['image-001.jpg']);
  assert.equal(requests.length, 2);
  await assert.rejects(() => downloadMedia({ imageList: [] }, directory), { code: 'EEXIST' });
});

test('unexpected content and redirects cannot become downloaded media', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xhscli-media-test-'));
  const directory = join(root, 'sample.media');
  let requests = 0;
  const result = await downloadMedia({ imageList: [picture('html'), picture('redirect')] }, directory, {
    fetchImpl: async url => {
      requests++;
      return url.endsWith('html') ? new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } })
        : new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
    }
  });
  assert.equal(requests, 2);
  assert.equal(result.complete, false);
  assert.equal(result.files[0].error.code, 'MEDIA_INVALID_CONTENT');
  assert.equal(result.files[1].error.code, 'MEDIA_REDIRECT_REJECTED');
  assert.deepEqual(await readdir(directory), []);
});
