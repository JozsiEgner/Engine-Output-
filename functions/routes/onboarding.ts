// functions/routes/onboarding.ts
// Onboarding lépések kezelése — Cloudflare Access + D1

import { Hono } from 'hono';
import type { Env, Variables } from '../lib/types';
import { getEmailFromRequest } from '../lib/auth';
import { uuid, nowISO } from '../lib/uuid';

const onboarding = new Hono<{ Bindings: Env; Variables: Variables }>();

const STEP_ORDER = ['ROLE', 'LEGAL', 'PROFILE', 'LOCATION', 'CAPABILITIES', 'PAYOUT', 'DONE'] as const;
type OnboardingStep = typeof STEP_ORDER[number];

function nextStep(current: string, role: string): OnboardingStep {
  const idx = STEP_ORDER.indexOf(current as OnboardingStep);
  // MANDATOR: LOCATION utan rovid ut → DONE
  if (current === 'LOCATION' && role === 'MANDATOR') return 'DONE';
  return STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)] as OnboardingStep;
}

// Profil + session lekerdese email alapjan
async function getProfileAndSession(db: D1Database, email: string) {
  const profile = await db
    .prepare('SELECT * FROM profiles WHERE email = ?')
    .bind(email)
    .first<Record<string, any>>();
  if (!profile) return { profile: null, session: null };

  const session = await db
    .prepare('SELECT * FROM onboarding_sessions WHERE uid = ?')
    .bind(profile.id)
    .first<Record<string, any>>();

  return { profile, session };
}

// GET /api/onboarding/session
onboarding.get('/session', async (c) => {
  const email = getEmailFromRequest(c.req.raw, c.env);
  if (!email) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  const { profile, session } = await getProfileAndSession(c.env.DB, email);
  if (!profile) return c.json({ error: 'Profil nem talalhato.' }, 404);

  const now = nowISO();

  // Ha meg nincs session, letrehozzuk
  if (!session) {
    const id = 'session_' + profile.id;
    await c.env.DB
      .prepare(`INSERT INTO onboarding_sessions
        (id, uid, current_step, completed_steps, missing_fields, created_at, updated_at)
        VALUES (?, ?, 'ROLE', '[]', '[]', ?, ?)
        ON CONFLICT(id) DO NOTHING`)
      .bind(id, profile.id, now, now)
      .run();

    return c.json({
      id,
      uid: profile.id,
      currentStep: 'ROLE',
      completedSteps: [],
      missingFields: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  return c.json({
    id:             session.id,
    uid:            session.uid,
    currentStep:    session.current_step   ?? 'ROLE',
    completedSteps: JSON.parse(session.completed_steps ?? '[]'),
    missingFields:  JSON.parse(session.missing_fields  ?? '[]'),
    requiresManualReview: !!session.requires_manual_review,
    reviewReason:   session.review_reason ?? null,
    createdAt:      session.created_at,
    updatedAt:      session.updated_at,
  });
});

// POST /api/onboarding/select-role
onboarding.post('/select-role', async (c) => {
  const email = getEmailFromRequest(c.req.raw, c.env);
  if (!email) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  const { profile, session } = await getProfileAndSession(c.env.DB, email);
  if (!profile) return c.json({ error: 'Profil nem talalhato.' }, 404);

  const body = await c.req.json<{ role: string }>();
  const role = body?.role;
  if (!['MANDATOR', 'AGENT', 'BOTH'].includes(role)) {
    return c.json({ error: 'Ervenytelen szerepkor.' }, 400);
  }

  const now = nowISO();
  const completedSteps = session
    ? JSON.parse(session.completed_steps ?? '[]')
    : [];
  if (!completedSteps.includes('ROLE')) completedSteps.push('ROLE');

  // Profil frissitese
  await c.env.DB
    .prepare(`UPDATE profiles SET role = ?, onboarding_status = 'ROLE_SELECTED', updated_at = ? WHERE id = ?`)
    .bind(role, now, profile.id)
    .run();

  // Session frissitese / letrehozasa
  const sessionId = 'session_' + profile.id;
  await c.env.DB
    .prepare(`INSERT INTO onboarding_sessions
      (id, uid, current_step, completed_steps, missing_fields, created_at, updated_at)
      VALUES (?, ?, 'LEGAL', ?, '[]', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        current_step = 'LEGAL',
        completed_steps = ?,
        updated_at = ?`)
    .bind(
      sessionId, profile.id, JSON.stringify(completedSteps), now, now,
      JSON.stringify(completedSteps), now
    )
    .run();

  return c.json({ ok: true, nextStep: 'LEGAL', role });
});

// POST /api/onboarding/update-step
onboarding.post('/update-step', async (c) => {
  const email = getEmailFromRequest(c.req.raw, c.env);
  if (!email) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  const { profile, session } = await getProfileAndSession(c.env.DB, email);
  if (!profile || !session) return c.json({ error: 'Session nem talalhato.' }, 404);

  const body = await c.req.json<{ expectedCurrentStep: string; data?: Record<string, any> }>();
  const { expectedCurrentStep, data } = body;

  const now = nowISO();
  const completedSteps: string[] = JSON.parse(session.completed_steps ?? '[]');
  if (!completedSteps.includes(expectedCurrentStep)) {
    completedSteps.push(expectedCurrentStep);
  }

  const next = nextStep(expectedCurrentStep, profile.role ?? 'MANDATOR');

  // Ha van extra adat (pl. PROFILE lepes: nev, telefon)
  if (data && typeof data === 'object') {
    const allowed: Record<string, string> = {
      fullName: 'full_name',
      phone:    'phone',
    };
    const sets: string[] = [];
    const vals: any[]    = [];
    for (const [key, col] of Object.entries(allowed)) {
      if (data[key] !== undefined) { sets.push(`${col} = ?`); vals.push(data[key]); }
    }
    if (sets.length > 0) {
      sets.push('updated_at = ?');
      vals.push(now, profile.id);
      await c.env.DB
        .prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...vals)
        .run();
    }
  }

  await c.env.DB
    .prepare(`UPDATE onboarding_sessions
      SET current_step = ?, completed_steps = ?, updated_at = ?
      WHERE uid = ?`)
    .bind(next, JSON.stringify(completedSteps), now, profile.id)
    .run();

  return c.json({ ok: true, nextStep: next });
});

// POST /api/onboarding/finalize
onboarding.post('/finalize', async (c) => {
  const email = getEmailFromRequest(c.req.raw, c.env);
  if (!email) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  const { profile } = await getProfileAndSession(c.env.DB, email);
  if (!profile) return c.json({ error: 'Profil nem talalhato.' }, 404);

  const now = nowISO();

  await c.env.DB
    .prepare(`UPDATE profiles SET onboarding_status = 'COMPLETED', updated_at = ? WHERE id = ?`)
    .bind(now, profile.id)
    .run();

  await c.env.DB
    .prepare(`UPDATE onboarding_sessions SET current_step = 'DONE', updated_at = ? WHERE uid = ?`)
    .bind(now, profile.id)
    .run();

  return c.json({ ok: true, nextStep: 'DONE' });
});

export default onboarding;
