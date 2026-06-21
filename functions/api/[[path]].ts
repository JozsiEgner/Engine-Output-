/**
 * ÉgnerRent — Cloudflare Pages Function (Hono)
 *
 * Az összes /api/* kérést kezeli.
 * KV-alapú rate limiting + spam/bot védelem AKTÍV.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Variables } from '../lib/types';
import { getAuthUser } from '../lib/auth';
import {
  checkRateLimit,
  getClientIp,
  isBotRequest,
  isIpBlocked,
} from '../lib/rateLimit';

// Route importok
import authRoutes       from '../routes/auth';
import taskRoutes       from '../routes/tasks';
import assignmentRoutes from '../routes/assignments';
import adminRoutes      from '../routes/admin';
import revolutRoutes    from '../routes/revolut';
import miscRoutes       from '../routes/misc';
import onboardingRoutes from '../routes/onboarding';
import debugRoutes      from '../routes/debug';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS
app.use('/*', cors({
  origin: (origin) => {
    const allowed = [
      'https://egner.rent',
      'https://www.egner.rent',
      'https://egnerrent.pages.dev',
      'http://localhost:5173',
      'http://localhost:4173',
      'http://localhost:8788',
    ];
    if (!origin) return '*';
    if (
      allowed.some((a) => origin === a) ||
      origin.endsWith('.egner.rent') ||
      origin.endsWith('.egnerrent.pages.dev')
    ) return origin;
    return null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ── Spam / Bot védelem middleware ─────────────────────────────────────────────
app.use('/api/*', async (c, next) => {
  // Webhook végpontok nem rate-limitáltak (Revolut stb.)
  if (c.req.path.includes('/webhooks/')) return next();

  if (!c.env.RATE_LIMIT_KV) {
    console.warn('[SpamGuard] RATE_LIMIT_KV nincs bekötve — védelem kikapcsolva');
    return await next();
  }

  const ip = getClientIp(c.req.raw);

  // 1. IP blokk-lista ellenőrzés (admin által tiltott IP-ek)
  if (await isIpBlocked(c.env.RATE_LIMIT_KV, ip)) {
    console.warn(`[SpamGuard] Blokkolt IP: ${ip}`);
    return c.json({ error: 'Hozzáférés megtagadva.' }, 403);
  }

  // 2. Bot User-Agent szűrés (auth végpontokon kötelező)
  const isAuthPath = c.req.path.startsWith('/api/auth');
  if (isAuthPath && isBotRequest(c.req.raw)) {
    console.warn(`[SpamGuard] Bot UA blokkolva: ${c.req.header('User-Agent')} — ${ip}`);
    return c.json({ error: 'Automatizált kérés megtagadva.' }, 403);
  }

  // 3. Rate limit:
  //    - /api/auth/*  → 20 kérés / 15 perc  (brute-force védelem)
  //    - egyéb API    → 100 kérés / 15 perc
  const rateLimitKey = isAuthPath ? `auth:${ip}` : ip;
  const rateLimitMax = isAuthPath ? 20 : 100;

  const { allowed, remaining } = await checkRateLimit(
    c.env.RATE_LIMIT_KV,
    rateLimitKey,
    { windowMs: 15 * 60 * 1000, max: rateLimitMax }
  );

  if (!allowed) {
    console.warn(`[SpamGuard] Rate limit túllépve: ${ip} — ${c.req.path}`);
    return c.json({ error: 'Túl sok kérés, próbáld újra 15 perc múlva.' }, 429);
  }

  c.res.headers.set('X-RateLimit-Remaining', String(remaining));
  await next();
});

// ── Auth middleware ────────────────────────────────────────────────────────────
app.use('/api/*', async (c, next) => {
  const user = await getAuthUser(c.req.raw, c.env);
  if (user) c.set('user', user);
  await next();
});

// ── Biztonsági fejlécek ───────────────────────────────────────────────────────
app.use('/api/*', async (c, next) => {
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('Content-Disposition', 'inline');
  c.res.headers.set('Cache-Control', 'no-store');
});

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

// Route mountok
app.route('/api/auth',        authRoutes);
app.route('/api/tasks',       taskRoutes);
app.route('/api/assignments', assignmentRoutes);
app.route('/api/admin',       adminRoutes);
app.route('/api/revolut',     revolutRoutes);
app.route('/api/onboarding',  onboardingRoutes);
app.route('/api/debug',       debugRoutes);
app.route('/api',             miscRoutes);

// 404 fallback
app.notFound((c) => c.json({ error: 'Nem található.' }, 404));

// Globális hibakezelő
app.onError((err, c) => {
  const detail = String((err as any)?.message ?? err);
  console.error('[Worker Error]', detail);
  return c.json({ error: detail }, 500);
});

export default app;

export const onRequest = async (context: any) => {
  return app.fetch(context.request, context.env, context);
};
