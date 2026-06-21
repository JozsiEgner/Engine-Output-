// Revolut webhook és fizetési route-ok
// A webhook HMAC-SHA256 aláírás-ellenőrzéssel védett.
import { Hono } from 'hono';
import type { Env, Variables } from '../lib/types';
import { uuid, nowISO } from '../lib/uuid';

const revolut = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─────────────────────────────────────────────────────────────────────────────
// HMAC-SHA256 aláírás verifikáció (Revolut webhook)
// ─────────────────────────────────────────────────────────────────────────────
async function verifyRevolutSignature(
  body: string,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  try {
    const parts = signatureHeader.split(',');
    const v1 = parts.find((p) => p.startsWith('v1='))?.slice(3);
    if (!v1) return false;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sig = Uint8Array.from(v1.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    return crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(body));
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/revolut/webhooks/merchant — Revolut Merchant webhook
// ─────────────────────────────────────────────────────────────────────────────
revolut.post('/webhooks/merchant', async (c) => {
  const signature = c.req.header('revolut-signature') ?? '';
  const bodyText  = await c.req.text();

  const valid = await verifyRevolutSignature(
    bodyText, signature, c.env.REVOLUT_MERCHANT_WEBHOOK_SECRET
  );
  if (!valid) return c.text('Invalid signature', 401);

  let event: any;
  try { event = JSON.parse(bodyText); } catch { return c.text('Bad JSON', 400); }

  const eventId = event.id as string;

  // Idempotencia
  const existing = await c.env.DB
    .prepare('SELECT id FROM processed_events WHERE id = ?')
    .bind(eventId).first();
  if (existing) return c.text('OK (Already processed)', 200);

  try {
    if (event.event === 'ORDER_COMPLETED') {
      const orderId = event.order_id;
      await c.env.DB.prepare(
        "UPDATE revolut_payments SET status = 'PAYMENT_COMPLETED', completed_at = ? WHERE id = ?"
      ).bind(nowISO(), orderId).run();

      await c.env.DB.prepare(`
        INSERT INTO ledger (id, amount, reference_type, reference_id, metadata, created_at)
        VALUES (?, (SELECT gross_amount FROM revolut_payments WHERE id = ?),
                'REVOLUT_PAYMENT_COMPLETED', ?, ?, ?)
      `).bind(uuid(), orderId, orderId, JSON.stringify({ eventId }), nowISO()).run();
    }

    if (['ORDER_CHARGEBACK','ORDER_PAYMENT_DECLINED'].includes(event.event)) {
      await c.env.DB.prepare("UPDATE revolut_payments SET status = ? WHERE id = ?")
        .bind(event.event, event.order_id).run();
    }

    await c.env.DB.prepare(
      'INSERT INTO processed_events (id, source, type, order_id, processed_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(eventId, 'MERCHANT', event.event, event.order_id ?? null, nowISO()).run();

  } catch (err) {
    await c.env.DB.prepare(`
      INSERT INTO webhook_dlq (id, source, event_type, raw_payload, error, created_at)
      VALUES (?, 'MERCHANT', ?, ?, ?, ?)
    `).bind(uuid(), event.event ?? 'UNKNOWN', bodyText,
      String(err instanceof Error ? err.message : err), nowISO()).run();
  }

  return c.text('OK', 200);
});

// ─────────────────────────────────────────────────────────────────────────────
// Belső helper: Revolut order létrehozás
// Elfogadja: assignmentId VAGY taskId (frontend kompatibilitás)
// ─────────────────────────────────────────────────────────────────────────────
async function createRevolutOrder(c: any, body: {
  assignmentId?: string;
  taskId?: string;
  amount: number;
  currency?: string;
  customerEmail?: string;
}) {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);

  // taskId alias assignmentId-ként kezelve
  const refId = body.assignmentId || body.taskId;
  const amount = body.amount;
  const currency = body.currency || 'HUF';

  if (!refId || !amount) {
    return c.json({ error: 'assignmentId (vagy taskId) és amount kötelező.' }, 400);
  }

  const revolutBase = (c.env.REVOLUT_ENV === 'live')
    ? 'https://merchant.revolut.com'
    : 'https://sandbox-merchant.revolut.com';

  let resp: Response;
  try {
    resp = await fetch(`${revolutBase}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.env.REVOLUT_MERCHANT_API_KEY}`,
      },
      body: JSON.stringify({
        amount: Math.round(amount),
        currency,
        description: `ÉgnerRent megbízás: ${refId}`,
        customer_email: user.email,
        metadata: { assignmentId: refId, taskId: refId, userId: user.id },
      }),
    });
  } catch (fetchErr: any) {
    return c.json({ error: 'Revolut API nem elérhető.', detail: String(fetchErr?.message) }, 502);
  }

  if (!resp.ok) {
    const errText = await resp.text();
    return c.json({
      error: 'Revolut order létrehozás sikertelen.',
      code: 'REVOLUT_ORDER_ERROR',
      detail: errText,
      hasApiKey: !!c.env.REVOLUT_MERCHANT_API_KEY,
    }, 502);
  }

  const order: any = await resp.json();

  // Payment rekord mentés D1-be
  try {
    await c.env.DB.prepare(`
      INSERT INTO revolut_payments (id, assignment_id, status, gross_amount, currency, customer_email, created_at)
      VALUES (?, ?, 'PENDING', ?, ?, ?, ?)
    `).bind(order.id, refId, amount, currency, user.email, nowISO()).run();
  } catch (dbErr) {
    console.error('[Revolut] D1 insert hiba:', dbErr);
    // Ne akadályozza meg a fizetést
  }

  // Visszaadjuk mind a két formátumot (régi + új frontend kompatibilitás)
  return c.json({
    orderId:     order.id,
    publicId:    order.public_id,     // RevolutCheckout widget-hez
    checkoutUrl: order.checkout_url,  // redirect flow-hoz
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/revolut/order — eredeti végpont (assignmentId payload)
// ─────────────────────────────────────────────────────────────────────────────
revolut.post('/order', async (c) => {
  const body = await c.req.json<any>();
  return createRevolutOrder(c, body);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/revolut/orders/create — frontend alias (taskId payload)
// ─────────────────────────────────────────────────────────────────────────────
revolut.post('/orders/create', async (c) => {
  const body = await c.req.json<any>();
  return createRevolutOrder(c, body);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/revolut/payments — admin: összes payment
// ─────────────────────────────────────────────────────────────────────────────
revolut.get('/payments', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Hitelesítés szükséges.' }, 401);
  if (!['ADMIN','SUPER_ADMIN'].includes(user.role)) return c.json({ error: 'Admin jogosultság szükséges.' }, 403);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM revolut_payments ORDER BY created_at DESC LIMIT 200'
  ).all();
  return c.json({ payments: results ?? [] });
});

export default revolut;
