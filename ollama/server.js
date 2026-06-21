/**
 * FreeTranslator v2.1 – Ollama Backend
 * Felváltja a Google Gemini-alapú server.ts-t.
 *
 * Végpontok:
 *   GET  /api/health      – Ollama + modell állapot
 *   GET  /api/models      – elérhető modellek listája
 *   POST /api/interpret   – SSE: szabályzó AGY értelmezése
 *   POST /api/translate   – SSE: fordítás streaming
 *   POST /api/route       – szemantikai irányrouting (sync JSON)
 */

'use strict';

const express = require('express');
const path    = require('path');
const { listModels, detectLargestModel, streamGenerate, generate, checkHealth, estimateContextWindow }
  = require('./ollama-client.js');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// ── GET /api/health ──────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  const status = await checkHealth();
  if (!status.ok) return res.status(503).json(status);

  let largest = null;
  try { largest = await detectLargestModel(); } catch { /* no models */ }
  res.json({ ...status, largest });
});

// ── GET /api/models ──────────────────────────────────────────────────────────
app.get('/api/models', async (_req, res) => {
  try {
    const models = await listModels();
    res.json({ models, largest: models[0]?.name || null });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// ── POST /api/interpret (SSE) ─────────────────────────────────────────────────
// Szabályzó AGY értelmezője – Gemini helyett Ollama
app.post('/api/interpret', async (req, res) => {
  const {
    engineType, step, matrixEnergy, reticleAngle,
    dominantDirection, distribution, trajectoryLog,
    model: reqModel
  } = req.body;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const model  = reqModel || await detectLargestModel();
    const numCtx = estimateContextWindow(model);
    const { north = 0, east = 0, south = 0, west = 0 } = distribution || {};

    const prompt =
`Te a Szabályzó AGY (0-1 Roulette Explorer) értelmezője vagy.
Aktuális állapot:
- Motor: ${engineType}, Lépés: ${step}, Energia: ${matrixEnergy}
- Irányzék szög: ${Number(reticleAngle).toFixed(1)}°
- Domináns irány: ${dominantDirection}
- Eloszlás: É=${north}% K=${east}% D=${south}% Ny=${west}%
- Utolsó 10 lépés: ${trajectoryLog}

Adj egy tömör, 2-3 mondatos értelmezést: mit csinál most a rendszer, milyen tendencia figyelhető meg?
Stílus: technikai, precíz, magyar nyelvű. Azonnal a lényegre térj, bevezető nélkül.`;

    for await (const chunk of streamGenerate(model, prompt, {
      options: { temperature: 0.4, num_predict: 256, num_ctx: numCtx }
    })) {
      if (chunk.response) send({ token: chunk.response });
      if (chunk.done)     { send({ done: true, model }); res.end(); return; }
    }

    send({ done: true, model });
    res.end();
  } catch (err) {
    send({ error: err.message });
    res.end();
  }
});

// ── POST /api/translate (SSE) ─────────────────────────────────────────────────
app.post('/api/translate', async (req, res) => {
  const {
    text, from = 'hu', to = 'en',
    model: reqModel, context = []
  } = req.body;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const model  = reqModel || await detectLargestModel();
    const numCtx = estimateContextWindow(model);

    // Tartály sűrűség: kontextus összecsomagolása
    const contextBlock = context.length > 0
      ? '\nKorábbi fordítások:\n' +
        context.slice(-4).map(c => `[${c.from}→${c.to}] "${c.input}" → "${c.output}"`).join('\n') + '\n'
      : '';

    const prompt =
`Fordítsd le a következő szöveget ${from} nyelvről ${to} nyelvre.
Csak a fordítást add vissza, semmilyen magyarázat nélkül.${contextBlock}
Szöveg: "${text}"
Fordítás:`;

    let fullText = '';

    for await (const chunk of streamGenerate(model, prompt, {
      options: { temperature: 0.3, num_predict: 512, num_ctx: numCtx }
    })) {
      if (chunk.response) {
        fullText += chunk.response;
        send({ token: chunk.response, full: fullText });
      }
      if (chunk.done) {
        send({
          done: true, fullText: fullText.trim(), model,
          stats: { tokens: chunk.eval_count, ms: chunk.eval_duration }
        });
        res.end();
        return;
      }
    }

    send({ done: true, fullText: fullText.trim(), model });
    res.end();
  } catch (err) {
    send({ error: err.message });
    res.end();
  }
});

// ── POST /api/route (sync JSON) ───────────────────────────────────────────────
// Szemantikai irányrouting: bemeneti szöveget → ÉSZAK/KELET/DÉL/NYUGAT súlyok
app.post('/api/route', async (req, res) => {
  const { text, model: reqModel } = req.body;

  try {
    const model = reqModel || await detectLargestModel();

    const prompt =
`You are a semantic direction routing engine for a 4-axis system.
Analyze the input and assign integer weights (0-100) to four semantic directions:
- NORTH (0°): questions, queries, information requests, "what/who/when"
- EAST (90°): translation, transformation, conversion, language processing
- SOUTH (180°): decisions, conclusions, answers, final assertions
- WEST (270°): learning, feedback, patterns, memory, self-improvement

Respond ONLY with valid JSON, nothing else: {"north": N, "east": E, "south": S, "west": W}

Input: "${text}"
Weights:`;

    const result = await generate(model, prompt, {
      options: { temperature: 0.1, num_predict: 64, num_ctx: 512 }
    });

    const jsonMatch = (result.response || '').match(/\{[^}]+\}/);
    if (jsonMatch) {
      const w = JSON.parse(jsonMatch[0]);
      return res.json({
        weights: { 0: w.north || 0, 90: w.east || 0, 180: w.south || 0, 270: w.west || 0 },
        model
      });
    }

    // Heurisztikus fallback – AI nélkül is működik
    const lower = text.toLowerCase();
    res.json({
      weights: {
        0:   lower.includes('?') || /\b(mi|ki|hol|mikor|what|who|when|where)\b/.test(lower) ? 65 : 12,
        90:  /\b(fordít|translat|convert|transform)\b/.test(lower) ? 65 : 25,
        180: /\b(igen|nem|yes|no|döntés|decision)\b/.test(lower) ? 65 : 15,
        270: /\b(tanuld|learn|remember|minta|pattern)\b/.test(lower) ? 65 : 10
      },
      model, fallback: true
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\nFreeTranslator v2.1 – Ollama backend`);
  console.log(`Szerver: http://localhost:${PORT}`);
  console.log(`Ollama:  ${require('./ollama-client.js').OLLAMA_BASE}`);

  const health = await checkHealth();
  if (health.ok) {
    console.log(`Ollama OK – ${health.modelCount} modell elérhető`);
    try {
      const largest = await detectLargestModel();
      console.log(`Auto-kiválasztott modell: ${largest}`);
      console.log(`Kontextusablak: ${estimateContextWindow(largest)} token`);
    } catch (e) {
      console.warn('Figyelmeztetés: nincs letöltött modell. Futtasd: ollama pull <modell>');
    }
  } else {
    console.warn(`Ollama nem elérhető: ${health.error}`);
    console.warn('Indítsd el az Ollama-t, majd töltsd le a modellt: ollama pull llama3');
  }
  console.log('');
});
