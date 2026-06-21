import { Hono } from 'hono';
import type { Env, Variables } from '../lib/types';
import { uuid, nowISO } from '../lib/uuid';

const assignments = new Hono<{ Bindings: Env; Variables: Variables }>();

interface Point { lat: number; lng: number; address?: string }

function haversineMeters(a: Point, b: Point): number {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const chord = sinDLat * sinDLat +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinDLon * sinDLon;
  return R * 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord));
}

// POST /api/assignments/request
assignments.post('/request', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);

  const { startPoint, finishPoint, cityKey } = await c.req.json<{
    startPoint: Point; finishPoint: Point; cityKey: string;
  }>();

  if (!startPoint?.lat || !startPoint?.lng || !finishPoint?.lat || !finishPoint?.lng) {
    return c.json({ error: 'startPoint és finishPoint (lat/lng) kötelező.' }, 400);
  }

  // Árazás lekérdezés
  const config = await c.env.DB.prepare(
    'SELECT * FROM pricing_config WHERE id = ?'
  ).bind('default').first<{ base_fee: number; per_km: number; platform_commission_rate: number }>();

  if (!config) return c.json({ error: 'Árazási konfiguráció nem található.' }, 500);

  const distanceMeters = haversineMeters(startPoint, finishPoint);
  const distanceKm = distanceMeters / 1000;
  const grossAmount = config.base_fee + distanceKm * config.per_km;
  const commissionAmount = grossAmount * config.platform_commission_rate;
  const agentNetEarnings = grossAmount - commissionAmount;
  const durationSeconds = distanceMeters / 5; // ~18 km/h átlag

  const id = uuid();
  const now = nowISO();

  await c.env.DB.prepare(`
    INSERT INTO assignments (
      id, client_id, status,
      start_lat, start_lng, start_address,
      finish_lat, finish_lng, finish_address,
      estimated_distance_meters, estimated_duration_seconds,
      gross_amount, commission_amount, agent_net_earnings,
      created_at, updated_at
    ) VALUES (?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, user.id,
    startPoint.lat, startPoint.lng, startPoint.address ?? null,
    finishPoint.lat, finishPoint.lng, finishPoint.address ?? null,
    Math.round(distanceMeters), Math.round(durationSeconds),
    Math.round(grossAmount), Math.round(commissionAmount), Math.round(agentNetEarnings),
    now, now
  ).run();

  return c.json({
    success: true,
    assignmentId: id,
    grossAmount: Math.round(grossAmount),
    commissionAmount: Math.round(commissionAmount),
    agentNetEarnings: Math.round(agentNetEarnings),
    estimatedDistanceMeters: Math.round(distanceMeters),
  }, 201);
});

// GET /api/assignments — saját megbízások
assignments.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);

  const { results } = await c.env.DB.prepare(`
    SELECT * FROM assignments
    WHERE client_id = ? OR agent_id = ?
    ORDER BY created_at DESC LIMIT 100
  `).bind(user.id, user.id).all();

  return c.json({ assignments: results });
});

// GET /api/assignments/:id
assignments.get('/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);

  const { id } = c.req.param();
  const assignment = await c.env.DB.prepare('SELECT * FROM assignments WHERE id = ?')
    .bind(id).first<{ client_id: string; agent_id: string | null }>();

  if (!assignment) return c.json({ error: 'Nem található.' }, 404);
  if (user.role !== 'ADMIN' && assignment.client_id !== user.id && assignment.agent_id !== user.id) {
    return c.json({ error: 'Hozzáférés megtagadva.' }, 403);
  }

  return c.json({ assignment });
});

// POST /api/assignments/:id/accept
assignments.post('/:id/accept', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);

  if (user.role !== 'AGENT' && user.role !== 'BOTH' && user.role !== 'ADMIN') {
    return c.json({ error: 'Csak megbízottak fogadhatnak el megbízást.' }, 403);
  }

  const { id } = c.req.param();
  const assignment = await c.env.DB.prepare('SELECT * FROM assignments WHERE id = ?')
    .bind(id).first<{ client_id: string; agent_id: string | null; status: string }>();

  if (!assignment) return c.json({ error: 'Nem található.' }, 404);
  if (assignment.status !== 'requested') return c.json({ error: 'Már nem szabad megbízás.' }, 400);
  if (assignment.client_id === user.id) return c.json({ error: 'Saját megbízást nem lehet elfogadni.' }, 403);

  await c.env.DB.prepare(`
    UPDATE assignments SET status = 'accepted', agent_id = ?, updated_at = ? WHERE id = ?
  `).bind(user.id, nowISO(), id).run();

  return c.json({ success: true });
});

// PATCH /api/assignments/:id/status
assignments.patch('/:id/status', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);

  const { id } = c.req.param();
  const { status } = await c.req.json<{ status: string }>();

  const valid = ['started', 'in_progress', 'completed', 'cancelled'];
  if (!valid.includes(status)) return c.json({ error: 'Érvénytelen státusz.' }, 400);

  const assignment = await c.env.DB.prepare('SELECT * FROM assignments WHERE id = ?')
    .bind(id).first<{ client_id: string; agent_id: string | null }>();

  if (!assignment) return c.json({ error: 'Nem található.' }, 404);
  if (user.role !== 'ADMIN' && assignment.client_id !== user.id && assignment.agent_id !== user.id) {
    return c.json({ error: 'Hozzáférés megtagadva.' }, 403);
  }

  const extra: Record<string, string> = {};
  if (status === 'started') extra['started_at'] = nowISO();
  if (status === 'completed') extra['completed_at'] = nowISO();

  const extraFields = Object.keys(extra).map((k) => `${k} = ?`).join(', ');
  const extraVals = Object.values(extra);

  await c.env.DB.prepare(
    `UPDATE assignments SET status = ?, updated_at = ?${extraFields ? ', ' + extraFields : ''} WHERE id = ?`
  ).bind(status, nowISO(), ...extraVals, id).run();

  return c.json({ success: true });
});

export default assignments;
