import { Hono } from 'hono';
import type { Env, Variables } from '../lib/types';
import { uuid, nowISO } from '../lib/uuid';

const tasks = new Hono<{ Bindings: Env; Variables: Variables }>();

// POST /api/tasks/create
tasks.post('/create', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);

  const { taskData } = await c.req.json<{ taskData: Record<string, unknown> }>();
  if (!taskData) return c.json({ error: 'taskData megadása kötelező.' }, 400);

  const { type, title, description, location_text, location_lat, location_lng, location_geohash, fee, zone_key } = taskData as any;
  if (!type || !title) return c.json({ error: 'type és title kötelező.' }, 400);

  const id = uuid();
  const now = nowISO();

  await c.env.DB.prepare(`
    INSERT INTO tasks (id, type, title, description, location_text, location_lat, location_lng,
      location_geohash, fee, status, financial_status, mandator_id, zone_key, is_night_tariff,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'PAYMENT_PENDING', ?, ?, 0, ?, ?)
  `).bind(id, type, title, description ?? null, location_text ?? null,
    location_lat ?? null, location_lng ?? null, location_geohash ?? null,
    fee ?? null, user.id, zone_key ?? null, now, now).run();

  return c.json({ taskId: id }, 201);
});

// GET /api/tasks — saját feladatok lekérdezése
tasks.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);

  const { results } = await c.env.DB.prepare(`
    SELECT * FROM tasks
    WHERE mandator_id = ? OR agent_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(user.id, user.id).all();

  return c.json({ tasks: results });
});

// GET /api/tasks/:taskId
tasks.get('/:taskId', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);

  const { taskId } = c.req.param();
  const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?')
    .bind(taskId).first();

  if (!task) return c.json({ error: 'A feladat nem található.' }, 404);

  // Csak admin, mandator vagy agent láthatja
  if (user.role !== 'ADMIN' && task.mandator_id !== user.id && task.agent_id !== user.id) {
    return c.json({ error: 'Hozzáférés megtagadva.' }, 403);
  }

  return c.json({ task });
});

// POST /api/tasks/:taskId/accept
tasks.post('/:taskId/accept', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);

  if (user.role !== 'AGENT' && user.role !== 'BOTH' && user.role !== 'ADMIN') {
    return c.json({ error: 'Csak megbízottak fogadhatnak el feladatot.' }, 403);
  }

  const { taskId } = c.req.param();
  const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?')
    .bind(taskId).first<{ id: string; mandator_id: string; status: string }>();

  if (!task) return c.json({ error: 'A feladat nem található.' }, 404);
  if (task.mandator_id === user.id) return c.json({ error: 'Saját feladatot nem lehet elfogadni.' }, 403);
  if (task.status !== 'PENDING') return c.json({ error: 'Ez a feladat már nem elérhető.' }, 400);

  await c.env.DB.prepare(`
    UPDATE tasks SET status = 'ACCEPTED', agent_id = ?, updated_at = ? WHERE id = ?
  `).bind(user.id, nowISO(), taskId).run();

  return c.json({ success: true });
});

// PATCH /api/tasks/:taskId/status
tasks.patch('/:taskId/status', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);

  const { taskId } = c.req.param();
  const { status } = await c.req.json<{ status: string }>();

  const validStatuses = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED'];
  if (!validStatuses.includes(status)) {
    return c.json({ error: `Érvénytelen státusz. Lehetséges: ${validStatuses.join(', ')}` }, 400);
  }

  const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?')
    .bind(taskId).first<{ mandator_id: string; agent_id: string }>();

  if (!task) return c.json({ error: 'Nem található.' }, 404);
  if (user.role !== 'ADMIN' && task.mandator_id !== user.id && task.agent_id !== user.id) {
    return c.json({ error: 'Hozzáférés megtagadva.' }, 403);
  }

  await c.env.DB.prepare(
    'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?'
  ).bind(status, nowISO(), taskId).run();

  return c.json({ success: true });
});

export default tasks;
