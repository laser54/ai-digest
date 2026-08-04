import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

function isPrivateIpv4(address) {
  const [a, b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224;
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase();
  return normalized === '::1' || normalized === '::' ||
    normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd');
}

export function assertPublicIp(address) {
  if ((isIP(address) === 4 && isPrivateIpv4(address)) ||
      (isIP(address) === 6 && isPrivateIpv6(address))) {
    throw new Error('URL resolves to a non-public network address');
  }
}

export async function validatePublicHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Source must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Source must be a credential-free HTTP(S) URL');
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new Error('Only standard HTTP(S) ports are allowed');
  }
  if (isIP(url.hostname)) {
    assertPublicIp(url.hostname);
  } else {
    const records = await lookup(url.hostname, { all: true, verbatim: true });
    if (!records.length) throw new Error('Source hostname did not resolve');
    records.forEach(({ address }) => assertPublicIp(address));
  }
  return url;
}
