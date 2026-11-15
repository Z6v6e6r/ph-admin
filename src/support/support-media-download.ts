import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';

export function publicV4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 2 && c === 0))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export function providerImageUrl(value: string, allowedHosts: readonly string[]): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      (url.port && url.port !== '443') || isIP(url.hostname) || !allowedHosts.includes(url.hostname)) {
    throw new Error('SUPPORT_MEDIA_SOURCE_FORBIDDEN');
  }
  return url;
}

export async function downloadProviderImage(value: string, allowedHosts: readonly string[],
  maximum: number, signal: AbortSignal, resolveHost: typeof lookup = lookup): Promise<Buffer> {
  const url = providerImageUrl(value, allowedHosts);
  const addresses = await abortable(resolveHost(url.hostname, { family: 4, all: true }), signal);
  if (signal.aborted || !addresses.length || addresses.some(x => !publicV4(x.address))) {
    throw new Error('SUPPORT_MEDIA_SOURCE_FORBIDDEN');
  }
  return new Promise((resolve, reject) => {
    // Bind the connection to the checked IP. A second DNS lookup cannot rebind it to a private host.
    const req = request(url, { method: 'GET', signal, timeout: 5000,
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, [{ address: addresses[0].address, family: 4 }]);
        else callback(null, addresses[0].address, 4);
      }, headers: { Accept: 'image/jpeg, image/png, image/webp' } }, response => {
      const length = Number(response.headers['content-length']);
      if (response.statusCode !== 200 || (Number.isFinite(length) && length > maximum)) {
        response.destroy(); reject(new Error('SUPPORT_MEDIA_DOWNLOAD_REFUSED')); return;
      }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maximum) response.destroy(new Error('SUPPORT_MEDIA_TOO_LARGE'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('SUPPORT_MEDIA_TIMEOUT')));
    req.on('error', reject); req.end();
  });
}

/** DNS itself cannot be cancelled; release request admission on deadline and ignore late results. */
export function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('SUPPORT_MEDIA_TIMEOUT'));
    if (signal.aborted) { pending.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
