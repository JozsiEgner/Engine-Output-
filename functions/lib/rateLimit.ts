// KV-alapú rate limiting + spam/bot védelem
// Fixed window: KV-ban tároljuk a kérésszámot TTL-lel.

import type { KVNamespace } from '@cloudflare/workers-types';

interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  options: RateLimitOptions
): Promise<{ allowed: boolean; remaining: number }> {
  const windowSec = Math.floor(options.windowMs / 1000);
  const kvKey = `rl:${key}`;

  const current = await kv.get(kvKey);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= options.max) {
    return { allowed: false, remaining: 0 };
  }

  await kv.put(kvKey, String(count + 1), { expirationTtl: windowSec });

  return { allowed: true, remaining: options.max - count - 1 };
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    'unknown'
  );
}

// Bot-gyanús User-Agent minták
const BOT_UA_PATTERNS = [
  /curl\//i,
  /python-requests/i,
  /Go-http-client/i,
  /libwww-perl/i,
  /scrapy/i,
  /wget\//i,
  /okhttp/i,
  /axios\/0\.[0-9]\./i,   // régi axios verziók (szkripteknél tipikus)
];

export function isBotRequest(request: Request): boolean {
  const ua = request.headers.get('User-Agent') || '';
  if (!ua) return true;  // nincs UA → biztosan bot
  return BOT_UA_PATTERNS.some((p) => p.test(ua));
}

// Blokkolt IP-ek KV-ban (admin állíthatja)
export async function isIpBlocked(kv: KVNamespace, ip: string): Promise<boolean> {
  const val = await kv.get(`block:${ip}`);
  return val !== null;
}

// Admin: IP tiltás / feloldás
export async function blockIp(kv: KVNamespace, ip: string, durationSec = 86400): Promise<void> {
  await kv.put(`block:${ip}`, '1', { expirationTtl: durationSec });
}

export async function unblockIp(kv: KVNamespace, ip: string): Promise<void> {
  await kv.delete(`block:${ip}`);
}
