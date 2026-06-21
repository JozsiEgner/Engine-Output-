// functions/routes/debug.ts
// CF Access diagnosztika — élesben is biztonságos:
// teljes JWT tokent NEM adja vissza, csak a dekodolt email claimet.

import { Hono } from 'hono';
import type { Env, Variables } from '../lib/types';
import { getAccessDebugInfo } from '../lib/auth';

const debug = new Hono<{ Bindings: Env; Variables: Variables }>();

debug.get('/access', async (c) => {
  const info = getAccessDebugInfo(c.req.raw, c.env);
  return c.json(info);
});

export default debug;
