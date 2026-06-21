// Notifications, Ledger, Legal, Zones, Onboarding, Finance, Messages, Offers, Maps, Reports
import { Hono } from 'hono';
import type { Env, Variables } from '../lib/types';
import { uuid, nowISO } from '../lib/uuid';

const misc = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
misc.get('/notifications', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(user.id).all();
  return c.json({ notifications: results });
});

misc.post('/notifications/:id/read', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id).run();
  return c.json({ success: true });
});

// ── LEDGER ────────────────────────────────────────────────────────────────────
misc.get('/ledger', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  if (!['ADMIN','SUPER_ADMIN'].includes(user.role)) return c.json({ error: 'Admin jogosultság szükséges.' }, 403);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM ledger ORDER BY created_at DESC LIMIT 200'
  ).all();
  return c.json({ ledger: results });
});

misc.get('/ledger/me', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM ledger WHERE from_wallet = ? OR to_wallet = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(user.id, user.id).all();
  return c.json({ entries: results });
});

// ── LEGAL ─────────────────────────────────────────────────────────────────────
misc.get('/legal', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, title, type, version, is_active, updated_at FROM legal_documents WHERE is_active = 1'
  ).all();
  return c.json({ documents: results });
});

misc.get('/legal/:id', async (c) => {
  const doc = await c.env.DB.prepare('SELECT * FROM legal_documents WHERE id = ? AND is_active = 1')
    .bind(c.req.param('id')).first();
  if (!doc) return c.json({ error: 'Nem található.' }, 404);
  return c.json({ document: doc });
});

misc.post('/legal/:id/accept', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const { id } = c.req.param();
  const doc = await c.env.DB.prepare('SELECT version FROM legal_documents WHERE id = ?')
    .bind(id).first<{ version: string }>();
  if (!doc) return c.json({ error: 'Dokumentum nem található.' }, 404);
  const ip = c.req.header('CF-Connecting-IP') ?? null;
  await c.env.DB.prepare(`
    INSERT INTO legal_acceptances (id, user_id, document_id, document_version, accepted_at, ip_address)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, document_id) DO UPDATE SET
      document_version = excluded.document_version,
      accepted_at = excluded.accepted_at,
      ip_address = excluded.ip_address
  `).bind(uuid(), user.id, id, doc.version, nowISO(), ip).run();
  return c.json({ success: true });
});

// ── ZONES ─────────────────────────────────────────────────────────────────────
misc.get('/zones', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM zones WHERE status = 'ACTIVE'"
  ).all();
  return c.json({ zones: results });
});

misc.get('/zones/:key', async (c) => {
  const zone = await c.env.DB.prepare('SELECT * FROM zones WHERE key = ?')
    .bind(c.req.param('key')).first();
  if (!zone) return c.json({ error: 'Zóna nem található.' }, 404);
  return c.json({ zone });
});

misc.post('/zones', async (c) => {
  const user = c.get('user');
  if (!user || !['ADMIN','SUPER_ADMIN'].includes(user.role)) return c.json({ error: 'Admin jogosultság szükséges.' }, 403);
  const body = await c.req.json<any>();
  const id = uuid(); const now = nowISO();
  await c.env.DB.prepare(`
    INSERT INTO zones (id, key, name, description, status, boundary_geojson, center_lat, center_lng, radius, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, body.key, body.name, body.description ?? null,
    body.status ?? 'ACTIVE',
    body.boundary_geojson ? JSON.stringify(body.boundary_geojson) : null,
    body.center_lat ?? null, body.center_lng ?? null, body.radius ?? null,
    now, now).run();
  return c.json({ zone: { id, ...body, created_at: now } });
});

misc.patch('/zones/:id', async (c) => {
  const user = c.get('user');
  if (!user || !['ADMIN','SUPER_ADMIN'].includes(user.role)) return c.json({ error: 'Admin jogosultság szükséges.' }, 403);
  const body = await c.req.json<any>();
  const now = nowISO();
  const fields = Object.keys(body).map(k => `${k} = ?`).join(', ');
  await c.env.DB.prepare(`UPDATE zones SET ${fields}, updated_at = ? WHERE id = ?`)
    .bind(...Object.values(body), now, c.req.param('id')).run();
  return c.json({ success: true });
});

misc.delete('/zones/:id', async (c) => {
  const user = c.get('user');
  if (!user || !['ADMIN','SUPER_ADMIN'].includes(user.role)) return c.json({ error: 'Admin jogosultság szükséges.' }, 403);
  await c.env.DB.prepare("UPDATE zones SET status = 'INACTIVE', updated_at = ? WHERE id = ?")
    .bind(nowISO(), c.req.param('id')).run();
  return c.json({ success: true });
});

// ── FINANCE / PRICING ─────────────────────────────────────────────────────────
misc.get('/finance/pricing', async (c) => {
  const config = await c.env.DB.prepare('SELECT * FROM pricing_config WHERE id = ?')
    .bind('default').first();
  return c.json({ config });
});

// ── ONBOARDING ────────────────────────────────────────────────────────────────
misc.get('/onboarding/session', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const session = await c.env.DB.prepare('SELECT * FROM onboarding_sessions WHERE uid = ?')
    .bind(user.id).first();
  return c.json({ session });
});

misc.patch('/onboarding/session', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const { current_step, completed_steps } = await c.req.json<any>();
  const updates: Record<string, unknown> = { updated_at: nowISO() };
  if (current_step) updates['current_step'] = current_step;
  if (completed_steps) updates['completed_steps'] = JSON.stringify(completed_steps);
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  await c.env.DB.prepare(`UPDATE onboarding_sessions SET ${fields} WHERE uid = ?`)
    .bind(...Object.values(updates), user.id).run();
  return c.json({ success: true });
});

misc.post('/onboarding/select-role', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const { role } = await c.req.json<{ role: string }>();
  const now = nowISO();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE profiles SET role = ?, updated_at = ? WHERE id = ?').bind(role, now, user.id),
    c.env.DB.prepare("UPDATE onboarding_sessions SET current_step = 'LEGAL', updated_at = ? WHERE uid = ?").bind(now, user.id),
  ]);
  return c.json({ success: true, role });
});

misc.post('/onboarding/update-step', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const { expectedCurrentStep, data } = await c.req.json<{ expectedCurrentStep: string; data?: any }>();
  const now = nowISO();
  const STEPS = ['ROLE','LEGAL','PROFILE','LOCATION','CAPABILITIES','PAYOUT','DONE'];
  const idx = STEPS.indexOf(expectedCurrentStep);
  const nextStep = idx >= 0 && idx < STEPS.length - 1 ? STEPS[idx + 1] : 'DONE';
  const sess = await c.env.DB.prepare('SELECT completed_steps FROM onboarding_sessions WHERE uid = ?')
    .bind(user.id).first<{ completed_steps: string }>();
  const completed: string[] = sess ? JSON.parse(sess.completed_steps || '[]') : [];
  if (!completed.includes(expectedCurrentStep)) completed.push(expectedCurrentStep);
  await c.env.DB.prepare(
    'UPDATE onboarding_sessions SET current_step = ?, completed_steps = ?, updated_at = ? WHERE uid = ?'
  ).bind(nextStep, JSON.stringify(completed), now, user.id).run();
  if (data && Object.keys(data).length > 0) {
    const allowed = ['full_name','phone','avatar_url','lat','lng'];
    const toUpdate = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
    if (Object.keys(toUpdate).length > 0) {
      const fields = Object.keys(toUpdate).map(k => `${k} = ?`).join(', ');
      await c.env.DB.prepare(`UPDATE profiles SET ${fields}, updated_at = ? WHERE id = ?`)
        .bind(...Object.values(toUpdate), now, user.id).run();
    }
  }
  return c.json({ success: true, nextStep });
});

misc.post('/onboarding/finalize', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const now = nowISO();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE onboarding_sessions SET current_step = 'DONE', updated_at = ? WHERE uid = ?").bind(now, user.id),
    c.env.DB.prepare("UPDATE profiles SET onboarding_status = 'COMPLETED', updated_at = ? WHERE id = ?").bind(now, user.id),
  ]);
  return c.json({ success: true });
});

misc.get('/onboarding/capabilities', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const cap = await c.env.DB.prepare('SELECT * FROM capability_profiles WHERE uid = ?').bind(user.id).first();
  return c.json({ capabilities: cap ?? null });
});

misc.post('/onboarding/capabilities', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const { profile } = await c.req.json<{ profile: any }>();
  const now = nowISO();
  await c.env.DB.prepare(`
    INSERT INTO capability_profiles (id, uid, skills, vehicle, languages, has_car, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET
      skills = excluded.skills, vehicle = excluded.vehicle,
      languages = excluded.languages, has_car = excluded.has_car,
      updated_at = excluded.updated_at
  `).bind(uuid(), user.id,
    JSON.stringify(profile.skills ?? []),
    profile.vehicle ?? null,
    JSON.stringify(profile.languages ?? []),
    profile.has_car ? 1 : 0, now).run();
  return c.json({ success: true });
});

// ── MAPS ──────────────────────────────────────────────────────────────────────
misc.get('/maps/agents', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT al.agent_id, al.lat, al.lng, al.is_online, al.updated_at,
           p.full_name, p.rating
    FROM agent_locations al
    JOIN profiles p ON p.id = al.agent_id
    WHERE al.is_online = 1
  `).all();
  return c.json({ agents: results });
});

misc.put('/maps/location', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const { lat, lng, geohash, is_online } = await c.req.json<any>();
  await c.env.DB.prepare(`
    INSERT INTO agent_locations (agent_id, lat, lng, geohash, is_online, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      lat = excluded.lat, lng = excluded.lng,
      geohash = excluded.geohash, is_online = excluded.is_online,
      updated_at = excluded.updated_at
  `).bind(user.id, lat, lng, geohash ?? null, is_online ? 1 : 0, nowISO()).run();
  return c.json({ success: true });
});

// Nyitott feladatok térképhez (location_lat/lng → lat/lng alias a kliensnek)
misc.get('/maps/tasks', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT id, title, type, status,
             location_lat, location_lng,
             location_geohash, created_at
      FROM tasks
      WHERE status IN ('PENDING','OFFER_MADE','ACCEPTED','IN_PROGRESS')
        AND location_lat IS NOT NULL AND location_lng IS NOT NULL
      LIMIT 500
    `).all();
    return c.json({ tasks: results ?? [] });
  } catch {
    return c.json({ tasks: [] });
  }
});

// ── MESSAGES ──────────────────────────────────────────────────────────────────
misc.get('/messages/:taskId', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const { results } = await c.env.DB.prepare(`
    SELECT m.*, p.full_name AS sender_name, p.avatar_url AS sender_avatar
    FROM messages m
    LEFT JOIN profiles p ON p.id = m.sender_id
    WHERE m.task_id = ?
    ORDER BY m.created_at ASC LIMIT 200
  `).bind(c.req.param('taskId')).all();
  return c.json({ messages: results });
});

misc.post('/messages/:taskId', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const { content } = await c.req.json<{ content: string }>();
  if (!content?.trim()) return c.json({ error: 'Üzenet nem lehet üres.' }, 400);
  const id = uuid(); const now = nowISO();
  await c.env.DB.prepare(
    'INSERT INTO messages (id, task_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, c.req.param('taskId'), user.id, content.trim(), now).run();
  return c.json({ message: { id, task_id: c.req.param('taskId'), sender_id: user.id, content, created_at: now } });
});

// ── OFFERS ────────────────────────────────────────────────────────────────────
misc.get('/tasks/:taskId/offers', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const { results } = await c.env.DB.prepare(`
    SELECT o.*, p.full_name AS agent_name, p.rating AS agent_rating
    FROM offers o
    JOIN profiles p ON p.id = o.agent_id
    WHERE o.task_id = ?
    ORDER BY o.created_at ASC
  `).bind(c.req.param('taskId')).all();
  return c.json({ offers: results });
});

misc.post('/tasks/:taskId/offers', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const { price, note } = await c.req.json<{ price: number; note?: string }>();
  const id = uuid(); const now = nowISO();
  await c.env.DB.prepare(
    "INSERT INTO offers (id, task_id, agent_id, price, note, status, created_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)"
  ).bind(id, c.req.param('taskId'), user.id, price, note ?? null, now).run();
  return c.json({ offer: { id, task_id: c.req.param('taskId'), agent_id: user.id, price, note, status: 'PENDING', created_at: now } });
});

misc.post('/tasks/:taskId/offers/:offerId/accept', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const { taskId, offerId } = c.req.param();
  const task = await c.env.DB.prepare('SELECT mandator_id FROM tasks WHERE id = ?')
    .bind(taskId).first<{ mandator_id: string }>();
  if (!task || task.mandator_id !== user.id) return c.json({ error: 'Nincs jogosultság.' }, 403);
  const now = nowISO();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE offers SET status = 'ACCEPTED', updated_at = ? WHERE id = ?").bind(now, offerId),
    c.env.DB.prepare("UPDATE offers SET status = 'DECLINED', updated_at = ? WHERE task_id = ? AND id != ?").bind(now, taskId, offerId),
    c.env.DB.prepare("UPDATE tasks SET status = 'ACCEPTED', updated_at = ? WHERE id = ?").bind(now, taskId),
  ]);
  return c.json({ success: true });
});

// ── REPORTS ───────────────────────────────────────────────────────────────────
misc.post('/reports', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const { target_id, target_type, reason, description } = await c.req.json<any>();
  await c.env.DB.prepare(`
    INSERT INTO reports (id, reporter_id, target_id, target_type, reason, description, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
  `).bind(uuid(), user.id, target_id, target_type, reason, description ?? null, nowISO()).run();
  return c.json({ success: true });
});

// ── GDPR ──────────────────────────────────────────────────────────────────────
misc.delete('/gdpr/me', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  const anon = `deleted_${user.id.slice(0, 8)}@deleted.invalid`;
  await c.env.DB.prepare(`
    UPDATE profiles SET email = ?, full_name = 'Törölt felhasználó',
    phone = NULL,
    avatar_url = NULL,
    updated_at = ?
  WHERE id = ?
  `).bind(anon, nowISO(), user.id).run();
  return c.json({ success: true });
});

export default misc;
