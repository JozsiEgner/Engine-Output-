/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono';
import type { Env, Variables } from '../lib/types';
import { uuid, nowISO } from '../lib/uuid';

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

// POST /api/admin/bootstrap-owner
// Biztonsagos egyszeri bootstrap: csak akkor fut, ha meg nincs SUPER_ADMIN/ADMIN a rendszerben.
// Az aktualis CF Access email kapja a SUPER_ADMIN szerepkort.
// Admin middleware ELOTT van, hogy elerheto legyen meg admin nelkul.
admin.post('/bootstrap-owner', async (c) => {
  const email = (c.req.raw.headers.get('Cf-Access-Authenticated-User-Email') ?? '').toLowerCase().trim();
  if (!email) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  // Ellenorzés: van-e mar SUPER_ADMIN vagy ADMIN?
  const existing = await c.env.DB
    .prepare("SELECT COUNT(*) as cnt FROM profiles WHERE role IN ('SUPER_ADMIN','ADMIN')")
    .first<{ cnt: number }>();
  if ((existing?.cnt ?? 0) > 0) {
    return c.json({ error: 'Mar van SUPER_ADMIN/ADMIN a rendszerben. Bootstrap nem fut.' }, 403);
  }

  const now = nowISO();
  const updated = await c.env.DB
    .prepare("UPDATE profiles SET role = 'SUPER_ADMIN', onboarding_status = 'COMPLETED', updated_at = ? WHERE email = ?")
    .bind(now, email)
    .run();

  return c.json({
    ok: true,
    message: `${email} → SUPER_ADMIN szerepkor beallitva.`,
    changes: updated.meta?.changes ?? 0,
  });
});

// Admin auth middleware — ADMIN es SUPER_ADMIN szerepkor egyarant elfogadott
admin.use('/*', async (c, next) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    return c.json({ error: 'Admin jogosultság szükséges.' }, 403);
  }
  await next();
});

// GET /api/admin/insights — AI elemzes (stub: ha nincs API kulcs, disabled allapot)
admin.get('/insights', async (c) => {
  const env = c.env as any;
  const hasAI = !!(env.GEMINI_API_KEY || env.AI_API_KEY || env.OPENAI_API_KEY);
  if (!hasAI) {
    return c.json({
      insights: [],
      enabled: false,
      message: 'AI elemzés jelenleg nincs bekapcsolva.',
    });
  }
  return c.json({ insights: [], enabled: true });
});

// GET /api/admin/stats
admin.get('/stats', async (c) => {
  const [tasks, users, agents, volume] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM tasks').first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM profiles').first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM agent_locations WHERE is_online = 1").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(gross_amount),0) as total FROM tasks WHERE status = 'COMPLETED'").first<{ total: number }>(),
  ]);
  return c.json({
    totalTasks: tasks?.count ?? 0,
    totalUsers: users?.count ?? 0,
    activeAgents: agents?.count ?? 0,
    totalVolume: volume?.total ?? 0,
  });
});

// GET /api/admin/users
admin.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM profiles ORDER BY created_at DESC LIMIT 500'
  ).all();
  return c.json({ users: results });
});

// PATCH /api/admin/users/:id/profile
admin.patch('/users/:id/profile', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<any>();
  const allowed = ['full_name','phone','avatar_url','role','banned','onboarding_status'];
  const toUpdate = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  if (Object.keys(toUpdate).length === 0) return c.json({ error: 'Nincs frissíthető mező.' }, 400);
  const fields = Object.keys(toUpdate).map(k => `${k} = ?`).join(', ');
  await c.env.DB.prepare(`UPDATE profiles SET ${fields}, updated_at = ? WHERE id = ?`)
    .bind(...Object.values(toUpdate), nowISO(), id).run();
  return c.json({ success: true });
});

// PATCH /api/admin/ban/:id
admin.patch('/ban/:id', async (c) => {
  const adminUser = c.get('user')!;
  const { id } = c.req.param();
  await c.env.DB.prepare('UPDATE profiles SET banned = 1, updated_at = ? WHERE id = ?')
    .bind(nowISO(), id).run();
  await c.env.DB.prepare(
    'INSERT INTO audit_logs (id, action, actor_id, entity_id, entity_type, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(uuid(), 'ADMIN_USER_BANNED', adminUser.id, id, 'profile', nowISO()).run();
  return c.json({ success: true });
});

// PATCH /api/admin/unban/:id
admin.patch('/unban/:id', async (c) => {
  const adminUser = c.get('user')!;
  const { id } = c.req.param();
  await c.env.DB.prepare('UPDATE profiles SET banned = 0, updated_at = ? WHERE id = ?')
    .bind(nowISO(), id).run();
  await c.env.DB.prepare(
    'INSERT INTO audit_logs (id, action, actor_id, entity_id, entity_type, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(uuid(), 'ADMIN_USER_UNBANNED', adminUser.id, id, 'profile', nowISO()).run();
  return c.json({ success: true });
});

// POST /api/admin/audit-log-entry
admin.post('/audit-log-entry', async (c) => {
  const actor = c.get('user')!;
  const { action, entity_id, entity_type, details } = await c.req.json<any>();
  await c.env.DB.prepare(
    'INSERT INTO audit_logs (id, action, actor_id, entity_id, entity_type, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(uuid(), action, actor.id, entity_id ?? null, entity_type ?? null, details ? JSON.stringify(details) : null, nowISO()).run();
  return c.json({ success: true });
});

// POST /api/admin/ledger-entry
admin.post('/ledger-entry', async (c) => {
  const { from_wallet, to_wallet, amount, type, reference_id, description } = await c.req.json<any>();
  await c.env.DB.prepare(`
    INSERT INTO ledger (id, from_wallet, to_wallet, amount, type, reference_id, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(uuid(), from_wallet ?? null, to_wallet ?? null, amount, type, reference_id ?? null, description ?? null, nowISO()).run();
  return c.json({ success: true });
});

// GET /api/admin/audit-log
admin.get('/audit-log', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 500);
  const action = c.req.query('action');
  let query = 'SELECT * FROM audit_logs';
  const params: unknown[] = [];
  if (action) { query += ' WHERE action = ?'; params.push(action); }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

// GET /api/admin/reports
admin.get('/reports', async (c) => {
  const status = c.req.query('status');
  let q = 'SELECT r.*, p.full_name as reporter_name FROM reports r LEFT JOIN profiles p ON p.id = r.reporter_id';
  const params: unknown[] = [];
  if (status) { q += ' WHERE r.status = ?'; params.push(status); }
  q += ' ORDER BY r.created_at DESC LIMIT 200';
  const { results } = await c.env.DB.prepare(q).bind(...params).all();
  return c.json({ reports: results });
});

admin.patch('/reports/:id', async (c) => {
  const { status, resolution_note } = await c.req.json<{ status: string; resolution_note?: string }>();
  await c.env.DB.prepare('UPDATE reports SET status = ?, resolution_note = ?, updated_at = ? WHERE id = ?')
    .bind(status, resolution_note ?? null, nowISO(), c.req.param('id')).run();
  return c.json({ success: true });
});

// POST /api/admin/pricing  (pricing_config update + version snapshot)
admin.post('/pricing', async (c) => {
  const adminUser = c.get('user')!;
  const body = await c.req.json<{ base_fee?: number; per_km?: number; platform_commission_rate?: number }>();
  const now = nowISO();
  const current = await c.env.DB.prepare('SELECT * FROM pricing_config WHERE id = ?')
    .bind('default').first<{ base_fee: number; per_km: number; platform_commission_rate: number; currency: string }>();
  const snapshot = { ...current, ...body };
  await c.env.DB.prepare(
    'INSERT INTO pricing_versions (id, config_snapshot, changed_by, created_at) VALUES (?, ?, ?, ?)'
  ).bind(uuid(), JSON.stringify(snapshot), adminUser.id, now).run();
  const updates: string[] = [];
  const vals: unknown[] = [];
  if (body.base_fee !== undefined) { updates.push('base_fee = ?'); vals.push(body.base_fee); }
  if (body.per_km !== undefined) { updates.push('per_km = ?'); vals.push(body.per_km); }
  if (body.platform_commission_rate !== undefined) { updates.push('platform_commission_rate = ?'); vals.push(body.platform_commission_rate); }
  if (updates.length > 0) {
    updates.push('updated_at = ?', 'updated_by = ?');
    vals.push(now, adminUser.id, 'default');
    await c.env.DB.prepare(`UPDATE pricing_config SET ${updates.join(', ')} WHERE id = ?`).bind(...vals).run();
  }
  return c.json({ success: true, snapshot });
});

// GET /api/admin/pricing/versions
admin.get('/pricing/versions', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM pricing_versions ORDER BY created_at DESC LIMIT 50'
  ).all();
  return c.json({ versions: results });
});

// POST /api/admin/pricing/versions
admin.post('/pricing/versions', async (c) => {
  const actor = c.get('user')!;
  const body = await c.req.json<any>();
  const id = uuid(); const now = nowISO();
  await c.env.DB.prepare(`
    INSERT INTO pricing_versions (id, version, status, base_config, type_overrides, config_snapshot, changed_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, body.version ?? now, body.status ?? 'DRAFT',
    JSON.stringify(body.base_config ?? {}), JSON.stringify(body.type_overrides ?? {}),
    JSON.stringify(body), actor.id, now, now).run();
  return c.json({ id, ...body, created_at: now });
});

// PATCH /api/admin/pricing/versions/:id
admin.patch('/pricing/versions/:id', async (c) => {
  const body = await c.req.json<any>();
  const fields = Object.keys(body).map(k => `${k} = ?`).join(', ');
  await c.env.DB.prepare(`UPDATE pricing_versions SET ${fields}, updated_at = ? WHERE id = ?`)
    .bind(...Object.values(body), nowISO(), c.req.param('id')).run();
  return c.json({ success: true });
});

// GET /api/admin/finance/settlements
admin.get('/finance/settlements', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM settlements ORDER BY created_at DESC LIMIT 200'
  ).all();
  return c.json({ settlements: results });
});

admin.patch('/finance/settlements/:id', async (c) => {
  const body = await c.req.json<any>();
  const fields = Object.keys(body).map(k => `${k} = ?`).join(', ');
  await c.env.DB.prepare(`UPDATE settlements SET ${fields}, updated_at = ? WHERE id = ?`)
    .bind(...Object.values(body), nowISO(), c.req.param('id')).run();
  return c.json({ success: true });
});

// GET /api/admin/finance/payouts
admin.get('/finance/payouts', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM revolut_payouts ORDER BY created_at DESC LIMIT 200'
  ).all();
  return c.json({ payouts: results });
});

admin.patch('/finance/payouts/:id', async (c) => {
  const body = await c.req.json<any>();
  const fields = Object.keys(body).map(k => `${k} = ?`).join(', ');
  await c.env.DB.prepare(`UPDATE revolut_payouts SET ${fields}, updated_at = ? WHERE id = ?`)
    .bind(...Object.values(body), nowISO(), c.req.param('id')).run();
  return c.json({ success: true });
});

// GET /api/admin/finance/records
admin.get('/finance/records', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM ledger ORDER BY created_at DESC LIMIT 500'
  ).all();
  return c.json({ records: results });
});

admin.patch('/finance/records/:id', async (c) => {
  const body = await c.req.json<any>();
  const fields = Object.keys(body).map(k => `${k} = ?`).join(', ');
  await c.env.DB.prepare(`UPDATE ledger SET ${fields} WHERE id = ?`)
    .bind(...Object.values(body), c.req.param('id')).run();
  return c.json({ success: true });
});

export default admin;
