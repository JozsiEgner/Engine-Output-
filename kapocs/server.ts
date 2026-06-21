/**
 * Ézó Kapocs – Express szerver
 *
 * API végpontok:
 *   GET  /api/kapocs/status        – rendszer áttekintés
 *   GET  /api/kapocs/citizens       – összes polgár
 *   GET  /api/kapocs/citizens/:id   – egy polgár + metszetek + prioritások
 *   GET  /api/kapocs/assets         – összes vagyontárgy
 *   POST /api/kapocs/citizens       – új polgár hozzáadása
 *   POST /api/kapocs/assets         – új vagyontárgy
 *   POST /api/kapocs/tick           – rendszer tick (geo-frissítés)
 *   GET  /api/kapocs/settlements    – halmazok
 *   GET  /api/kapocs/export         – teljes registry export (JSON)
 */

import express from 'express';
import path    from 'path';
import dotenv  from 'dotenv';
import { createServer as createViteServer } from 'vite';

// Node-kompatibilis inicializálás (nem browser EzoCore)
import type { Citizen, Asset } from './src/lib/types';

if (process.env.NODE_ENV !== 'production') dotenv.config();

// Egyszerű in-memory store a szerver oldalon
// (a React kliens saját kapocsEngine-t használ)
const store = {
  citizens:    [] as Citizen[],
  assets:      [] as Asset[],
  step:        0,
};

async function start() {
  const app  = express();
  const PORT = parseInt(process.env.PORT || '3000');

  app.use(express.json());

  // ── API ────────────────────────────────────────────────────────────────────

  app.get('/api/kapocs/status', (_req, res) => {
    res.json({
      ok:          true,
      step:        store.step,
      citizens:    store.citizens.length,
      assets:      store.assets.length,
      version:     '1.0.0',
      engineType:  'weyl',
    });
  });

  app.get('/api/kapocs/citizens', (_req, res) => {
    res.json(store.citizens);
  });

  app.get('/api/kapocs/citizens/:id', (req, res) => {
    const c = store.citizens.find(x => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'Nem található' });
    const assets = store.assets.filter(a => a.ownerId === c.id);
    res.json({ citizen: c, assets });
  });

  app.post('/api/kapocs/citizens', (req, res) => {
    const body = req.body as Partial<Citizen>;
    if (!body.id || !body.name) return res.status(400).json({ error: 'Hiányzó id vagy name' });
    const citizen: Citizen = {
      id:            body.id,
      name:          body.name,
      settlementId:  body.settlementId || 'bp',
      trustLevel:    body.trustLevel   || 'kozepes',
      trustScore:    body.trustScore   ?? 0.7,
      kapocsTokemId: body.kapocsTokemId || `EK-${body.id.toUpperCase().slice(0, 6)}-AUTO`,
      metadata:      body.metadata     ?? {},
    };
    store.citizens.push(citizen);
    res.status(201).json(citizen);
  });

  app.get('/api/kapocs/assets', (_req, res) => {
    res.json(store.assets);
  });

  app.post('/api/kapocs/assets', (req, res) => {
    const body = req.body as Partial<Asset>;
    if (!body.id || !body.name || !body.ownerId) return res.status(400).json({ error: 'Hiányzó id, name vagy ownerId' });
    const asset: Asset = {
      id:          body.id,
      type:        body.type    || 'ingosag',
      name:        body.name,
      ownerId:     body.ownerId,
      settlementId: body.settlementId || 'bp',
      value:       body.value,
      status:      body.status  || 'fuggo',
      metadata:    body.metadata ?? {},
    };
    store.assets.push(asset);
    res.status(201).json(asset);
  });

  app.post('/api/kapocs/tick', (_req, res) => {
    store.step++;
    res.json({ step: store.step, ts: Date.now() });
  });

  app.get('/api/kapocs/settlements', (_req, res) => {
    res.json({ message: 'Settlements available in client-side kapocsEngine', settlements: ['bp', 'db', 'pe'] });
  });

  app.get('/api/kapocs/export', (_req, res) => {
    res.json({
      version:    '1.0.0',
      exportedAt: Date.now(),
      citizens:   store.citizens,
      assets:     store.assets,
    });
  });

  // ── Vite SPA ───────────────────────────────────────────────────────────────

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(process.cwd(), 'dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ézó Kapocs szerver: http://localhost:${PORT}`);
  });
}

start();
