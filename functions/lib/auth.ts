// functions/lib/auth.ts
// Cloudflare Access alapu autentikacio
//
// Eles modban:
//   1. Cf-Access-Authenticated-User-Email header (CF Access adja, hamisithatatlan)
//   2. Cf-Access-Jwt-Assertion header JWT payload email claimje (fallback)
//
// Lokalis / development modban:
//   X-Dev-User-Email header (opcionalis)
//   Ha egyik sem erkezik: automatikus dev@egnerrent.hu fallback

import type { Env, AuthUser } from './types';

const DEV_FALLBACK_EMAIL = 'dev@egnerrent.hu';

function isLocalRequest(request: Request, env: Env): boolean {
  try {
    const host = new URL(request.url).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
  } catch {}
  return env.NODE_ENV === 'development' || (env as any).CF_PAGES_BRANCH === 'local';
}

function getHeader(request: Request, name: string): string | null {
  return request.headers.get(name) ?? request.headers.get(name.toLowerCase()) ?? null;
}

function extractEmailFromJwt(jwt: string): string | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(payload);
    const data = JSON.parse(json);
    const email = data?.email ?? data?.sub ?? null;
    if (typeof email === 'string' && email.includes('@')) {
      return email.toLowerCase().trim();
    }
    return null;
  } catch {
    return null;
  }
}

export function getEmailFromRequest(request: Request, env: Env): string | null {
  // 1. Email header (legmegbizhatobb)
  const cfEmail = getHeader(request, 'Cf-Access-Authenticated-User-Email');
  if (cfEmail) return cfEmail.toLowerCase().trim();

  // 2. JWT Assertion payload email (fallback)
  const jwt = getHeader(request, 'Cf-Access-Jwt-Assertion');
  if (jwt) {
    const jwtEmail = extractEmailFromJwt(jwt);
    if (jwtEmail) return jwtEmail;
  }

  // 3. Lokalis fejlesztesi mod
  if (isLocalRequest(request, env)) {
    const devEmail = getHeader(request, 'X-Dev-User-Email');
    if (devEmail) return devEmail.toLowerCase().trim();
    return DEV_FALLBACK_EMAIL;
  }

  return null;
}

export function getCurrentUser(
  request: Request,
  env: Env
): { email: string; name: string } | null {
  const email = getEmailFromRequest(request, env);
  if (!email) return null;
  return { email, name: email.split('@')[0] };
}

export async function getAuthUser(
  request: Request,
  env: Env
): Promise<AuthUser | null> {
  const email = getEmailFromRequest(request, env);
  if (!email) return null;
  try {
    const profile = await env.DB.prepare(
      'SELECT id, email, role, banned FROM profiles WHERE email = ?'
    )
      .bind(email)
      .first<{ id: string; email: string; role: string; banned: number }>();
    if (!profile) return null;
    if (profile.banned) return null;
    return {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      banned: !!profile.banned,
    };
  } catch {
    return null;
  }
}

// Debug segédfüggvény — csak /api/debug/access használja
export function getAccessDebugInfo(request: Request, env: Env) {
  const emailHeader = getHeader(request, 'Cf-Access-Authenticated-User-Email');
  const jwt         = getHeader(request, 'Cf-Access-Jwt-Assertion');
  const jwtEmail    = jwt ? extractEmailFromJwt(jwt) : null;

  return {
    hasEmailHeader:     !!emailHeader,
    emailHeaderValue:   emailHeader ?? null,
    hasJwtHeader:       !!jwt,
    jwtPayloadHasEmail: !!jwtEmail,
    jwtEmail:           jwtEmail ?? null,
    host:               request.headers.get('host') ?? null,
    url:                request.url,
    hasDB:              !!env.DB,
  };
}
