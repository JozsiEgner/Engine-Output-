// functions/routes/auth.ts
import { Hono } from 'hono';
import type { Env, Variables } from '../lib/types';
import { getEmailFromRequest } from '../lib/auth';
import { uuid, nowISO } from '../lib/uuid';

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

auth.get('/me', async (c) => {
  // Anti-download fejlecek – mobilon megeloezi a me.json letoltesi hibaet
  c.header('Content-Type', 'application/json; charset=utf-8');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Disposition', 'inline');
  c.header('Cache-Control', 'no-store');

  const cfEmail = c.req.raw.headers.get('Cf-Access-Authenticated-User-Email');
  const email = getEmailFromRequest(c.req.raw, c.env);

  console.log('[/me] DB binding:', !!c.env.DB);
  console.log('[/me] Cf-Access-Authenticated-User-Email:', cfEmail ?? '(nincs)');
  console.log('[/me] resolved email:', email ?? '(nincs)');

  if (!email) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  const now = nowISO();
  try {
    let profile = await c.env.DB
      .prepare('SELECT * FROM profiles WHERE email = ?')
      .bind(email)
      .first<Record<string, unknown>>();

    if (!profile) {
      const id = uuid();

      // Bootstrap: ha meg egyetlen profil sincs a rendszerben, az elso belopo OWNER lesz.
      const countRow = await c.env.DB
        .prepare('SELECT COUNT(*) as cnt FROM profiles')
        .first<{ cnt: number }>();
      const isFirstUser = (countRow?.cnt ?? 0) === 0;
      const newRole = isFirstUser ? 'ADMIN' : 'MANDATOR';

      console.log(`[/me] Uj profil: ${email}, szerepkor: ${newRole} (elso user: ${isFirstUser})`);

      await c.env.DB.prepare(
        'INSERT INTO profiles (id, email, full_name, role, onboarding_status, banned, created_at, updated_at) VALUES (?, ?, NULL, ?, \'CREATED\', 0, ?, ?)'
      ).bind(id, email, newRole, now, now).run();

      await c.env.DB.prepare(
        'INSERT INTO wallets (user_id, balance, currency, updated_at) VALUES (?, 0, \'HUF\', ?) ON CONFLICT(user_id) DO NOTHING'
      ).bind(id, now).run();

      await c.env.DB.prepare(
        'INSERT INTO onboarding_sessions (id, uid, current_step, completed_steps, missing_fields, created_at, updated_at) VALUES (?, ?, \'ROLE\', \'[]\', \'[]\', ?, ?) ON CONFLICT(id) DO NOTHING'
      ).bind('session_' + id, id, now, now).run();

      profile = await c.env.DB
        .prepare('SELECT * FROM profiles WHERE id = ?')
        .bind(id)
        .first<Record<string, unknown>>();
    }

    if ((profile as any)?.banned) {
      return c.json({ error: 'A fiok fel van fuggesztve.' }, 403);
    }
    return c.json({ user: profile, profile });
  } catch (err: any) {
    const detail = String(err?.message ?? err);
    console.error('[Auth /me] D1 hiba:', detail);
    console.error('[Auth /me] DB binding:', !!c.env.DB);
    return c.json({ error: 'D1 adatbazis nem elerheto.', detail, hint: 'check-d1-binding' }, 503);
  }
});

auth.patch('/me', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  const body = await c.req.json<Record<string, unknown>>();
  const allowed = ['full_name', 'phone'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'Nincs frissitheto mezo.' }, 400);
  }
  updates['updated_at'] = nowISO();
  const fields = Object.keys(updates).map((k) => k + ' = ?').join(', ');
  
  const values = [...Object.values(updates), user.id];
  await c.env.DB
    .prepare('UPDATE profiles SET ' + fields + ' WHERE id = ?')
    .bind(...values)
    .run();
  const profile = await c.env.DB
    .prepare('SELECT * FROM profiles WHERE id = ?')
    .bind(user.id)
    .first();
  return c.json({ profile });
});

auth.post('/logout', (c) => {
  return c.json({ redirect: '/cdn-cgi/access/logout' });
});

export default auth;
