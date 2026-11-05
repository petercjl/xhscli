import { mkdir, open, link, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { failure } from './browser.mjs';

export function mediaUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!['xhscdn.com', 'xhscdn.net', 'xiaohongshu.com'].some(domain => url.hostname.endsWith('.' + domain))) return null;
    url.protocol = 'https:';
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function candidates(values) {
  return [...new Set(values.map(mediaUrl).filter(Boolean))];
}

function videoUrls(stream) {
  if (!stream || typeof stream !== 'object') return [];
  const formats = Object.keys(stream).sort((a, b) => Number(b === 'h264') - Number(a === 'h264'));
  return candidates(formats.flatMap(format => {
    const variants = Array.isArray(stream[format]) ? stream[format] : [];
    return [...variants].sort((a, b) => (Number(b.width) * Number(b.height) || 0) - (Number(a.width) * Number(a.height) || 0)
      || (Number(b.videoBitrate) || 0) - (Number(a.videoBitrate) || 0))
      .flatMap(item => [item.masterUrl, item.master_url, ...(item.backupUrls ?? item.backup_urls ?? [])]);
  }));
}

export function planMedia(note) {
  const assets = [];
  for (const [index, image] of (note.imageList ?? []).entries()) {
    const urls = candidates([image.urlDefault, image.url, ...(image.infoList ?? []).map(info => info.url), image.urlPre]);
    assets.push({ kind: 'image', role: note.type === 'video' ? 'cover' : 'image', index: index + 1, urls });
    if (image.livePhoto) assets.push({ kind: 'video', role: 'live-photo', index: index + 1, urls: videoUrls(image.stream) });
  }
  if (note.type === 'video') {
    const video = note.video ?? {};
    const urls = candidates([...videoUrls(video.media?.stream), video.masterUrl, video.url]);
    assets.push({ kind: 'video', role: 'video', index: 1, urls });
  }
  return assets;
}

export function identifyMedia(buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { kind: 'image', extension: 'jpg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { kind: 'image', extension: 'png' };
  if (/^GIF8[79]a/.test(buffer.subarray(0, 6).toString('ascii'))) return { kind: 'image', extension: 'gif' };
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { kind: 'image', extension: 'webp' };
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (['avif', 'avis'].includes(brand)) return { kind: 'image', extension: 'avif' };
    if (['heic', 'heix', 'mif1', 'msf1'].includes(brand)) return { kind: 'image', extension: 'heic' };
    return { kind: 'video', extension: 'mp4' };
  }
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { kind: 'video', extension: 'webm' };
  throw failure('MEDIA_INVALID_CONTENT', 'The resource did not contain a supported image or video file.');
}

async function downloadFile(response, asset, directory, sourceUrl) {
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!response.body || /text\/|json|mpegurl|xml/.test(mime)) {
    await response.body?.cancel();
    throw failure('MEDIA_INVALID_CONTENT', 'The media URL returned a document instead of a media file.');
  }
  const stem = asset.role + '-' + String(asset.index).padStart(3, '0');
  const temporary = join(directory, stem + '.part');
  const file = await open(temporary, 'wx', 0o600);
  let size = 0;
  let prefix = Buffer.alloc(0);
  const hash = createHash('sha256');
  const inspect = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      if (prefix.length < 32) prefix = Buffer.concat([prefix, chunk.subarray(0, 32 - prefix.length)]);
      callback(null, chunk);
    }
  });
  try {
    const destination = createWriteStream(temporary, { fd: file.fd, autoClose: false });
    await pipeline(Readable.fromWeb(response.body), inspect, destination);
    await file.close();
    const kind = identifyMedia(prefix);
    if (kind.kind !== asset.kind) throw failure('MEDIA_INVALID_CONTENT', 'The media type did not match the requested asset.');
    const advertised = response.headers.get('content-length');
    if (!response.headers.has('content-encoding') && advertised && Number(advertised) !== size) {
      throw failure('MEDIA_TRUNCATED', 'The downloaded file size did not match the response.');
    }
    const name = stem + '.' + kind.extension;
    await link(temporary, join(directory, name));
    return { status: 'downloaded', sourceUrl, path: basename(directory) + '/' + name, bytes: size, sha256: hash.digest('hex') };
  } finally {
    await file.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

export async function downloadMedia(note, directory, { fetchImpl = fetch } = {}) {
  await mkdir(directory, { mode: 0o700 });
  const files = [];
  async function request(url) {
    return fetchImpl(url, {
      headers: { Referer: 'https://www.xiaohongshu.com/' },
      redirect: 'manual', signal: AbortSignal.timeout(120000)
    });
  }
  for (const asset of planMedia(note)) {
    const entry = { kind: asset.kind, role: asset.role, index: asset.index, attempts: [] };
    if (!asset.urls.length) {
      files.push({ ...entry, status: 'failed', error: { code: 'MEDIA_SOURCE_MISSING', message: 'No downloadable source URL was provided by the note.' } });
      continue;
    }
    let downloaded;
    for (const initial of asset.urls) {
      let url = initial;
      try {
        for (let redirects = 0; ; redirects++) {
          const response = await request(url);
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            await response.body?.cancel();
            const next = location ? mediaUrl(new URL(location, url).href) : null;
            if (redirects >= 5 || !next) throw failure('MEDIA_REDIRECT_REJECTED', 'The media redirect was unavailable or outside the provider CDN.');
            url = next;
            continue;
          }
          if (!response.ok || response.status === 206) {
            await response.body?.cancel();
            throw failure('MEDIA_HTTP_ERROR', 'The media server returned HTTP ' + response.status + '.');
          }
          downloaded = await downloadFile(response, asset, directory, url);
          break;
        }
        entry.attempts.push({ url: initial, status: 'downloaded' });
        break;
      } catch (error) {
        entry.attempts.push({ url: initial, status: 'failed', code: error.code ?? 'MEDIA_DOWNLOAD_FAILED' });
      }
    }
    files.push({ ...entry, ...(downloaded ?? { status: 'failed', error: { code: entry.attempts.at(-1).code, message: 'All supplied source URLs failed for this asset.' } }) });
  }
  return { requested: true, directory: basename(directory), complete: files.every(file => file.status === 'downloaded'), files };
}
