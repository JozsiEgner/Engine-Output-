/**
 * FreeTranslator v2.1 – Ollama Backend
 *
 * Végpontok:
 *   GET  /api/health      – Ollama + modell állapot
 *   GET  /api/models      – elérhető modellek listája
 *   POST /api/interpret   – SSE: szabályzó AGY értelmezése
 *   POST /api/translate   – SSE: fordítás streaming
 *   POST /api/route       – szemantikai irányrouting (sync JSON)
 *   POST /api/decide      – kettős réteg döntési mátrix
 *   GET  /api/weights     – súlyPontszám tábla
 *   GET  /api/qr          – QR kód SVG (min. V1 21×21 modul)
 *   POST /api/distance    – távolság viszonypárok
 *   GET  /api/cortex      – Cortex ütemező állapot (GPU-analóg hőtérkép)
 *   GET  /api/doctor      – GPU Dark Silicon Doctor diagnózis
 *   GET  /api/slices      – Funkció szelet állapot (irányzott metszetek)
 */

'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { listModels, detectLargestModel, streamGenerate, generate, checkHealth, estimateContextWindow }
  = require('./ollama-client.js');
const { compute: decisionCompute, getAllWeights } = require('../src/decision-matrix.js');
const QRCode = require('qrcode');
const { buildQRUrl, calcDistancePairs, calcOrganizationScore, QR_ENDPOINTS } = require('../src/qr-entry.js');
const { scheduler } = require('../src/cortex-scheduler.js');
const { calcAllColumns, applyAllColumnConstraints, calcStructuralIntegrity } = require('../src/structural-columns.js');
const { catalog: legoCatalog } = require('../src/atom-lego.js');
const { GpuDarkSiliconDoctor, ShadowRegistry } = require('../src/dark-silicon-doctor.js');
const { registry: sliceRegistry } = require('../src/function-slice.js');
const { ezoAgent } = require('../src/ezo-agent.js');

// ── GPU Dark Silicon Doctor + Árnyék példányosítás ────────────────────────────
const shadows = new ShadowRegistry();
// Alap 4 típusra 2-2 árnyék egységet hozunk létre
['north', 'east', 'south', 'west'].forEach(t => {
  shadows.createShadow(t);
  shadows.createShadow(t);
});
const doctor = new GpuDarkSiliconDoctor(scheduler, shadows);
doctor.startAutoScan();   // 3 másodpercenként automatikus diagnózis

// Árnyék tick: 5 másodpercenként hővezérlés
setInterval(() => shadows.tick(), 5000);

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Leválasztható mód: ha OFFLINE=1, Ollama nélkül is fut (csak döntési mátrix) ──
const OFFLINE_MODE = process.env.OFFLINE === '1';
if (OFFLINE_MODE) console.log('[OFFLINE MÓD] Ollama API ki van kapcsolva.');

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// ── GET /api/health ──────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  if (OFFLINE_MODE) return res.json({ ok: false, offline: true, error: 'Offline mód aktív', modelCount: 0 });
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

// ── GET /api/models ──────────────────────────────────────────────────────────
// (felülírja a korábbi /api/models blokkot offline-biztos módon)

// ── POST /api/interpret (SSE) ─────────────────────────────────────────────────
// Szabályzó AGY értelmezője – Gemini helyett Ollama
app.post('/api/interpret', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (OFFLINE_MODE) {
    res.write(`data: ${JSON.stringify({ token: '[Offline mód] Ollama leválasztva. Csak a döntési mátrix érhető el.' })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    return res.end();
  }

  const {
    engineType, step, matrixEnergy, reticleAngle,
    dominantDirection, distribution, trajectoryLog,
    model: reqModel
  } = req.body;

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // Cortex: Észak irány (Értelmezés/Kérdés), reticle szög alapú routing
  const t0   = Date.now();
  const unit = scheduler.allocate('north', 0.55, reticleAngle);

  try {
    const model  = reqModel || await detectLargestModel();
    const numCtx = estimateContextWindow(model);
    const { params: throttled, band, delayMs } = scheduler.throttleParams({
      temperature: 0.4, num_predict: 256, num_ctx: numCtx
    });
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));

    const { north = 0, east = 0, south = 0, west = 0 } = distribution || {};

    const prompt =
`Te a Szabályzó AGY (0-1 Roulette Explorer) értelmezője vagy.
Aktuális állapot:
- Motor: ${engineType}, Lépés: ${step}, Energia: ${matrixEnergy}
- Irányzék szög: ${Number(reticleAngle).toFixed(1)}°
- Domináns irány: ${dominantDirection}
- Eloszlás: É=${north}% K=${east}% D=${south}% Ny=${west}%
- Utolsó 10 lépés: ${trajectoryLog}
- Cortex hőmérséklet: ${Math.round(scheduler.thermal * 100)}% (${band.label})

Adj egy tömör, 2-3 mondatos értelmezést: mit csinál most a rendszer, milyen tendencia figyelhető meg?
Stílus: technikai, precíz, magyar nyelvű. Azonnal a lényegre térj, bevezető nélkül.`;

    for await (const chunk of streamGenerate(model, prompt, { options: throttled })) {
      if (chunk.response) send({ token: chunk.response });
      if (chunk.done) {
        scheduler.release(unit.id, 0.55, Date.now() - t0);
        send({ done: true, model, cortex: { band: band.name, thermalPct: Math.round(scheduler.thermal * 100) } });
        res.end();
        return;
      }
    }

    scheduler.release(unit.id, 0.55, Date.now() - t0);
    send({ done: true, model });
    res.end();
  } catch (err) {
    scheduler.release(unit.id, 0.55, Date.now() - t0);
    send({ error: err.message });
    res.end();
  }
});

// ── POST /api/translate (SSE) ─────────────────────────────────────────────────
app.post('/api/translate', async (req, res) => {
  const {
    text, from = 'hu', to = 'en',
    model: reqModel, context = [], reticleAngle = null
  } = req.body;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // Cortex: Kelet irány (Fordítás), reticle szög alapú routing
  const t0   = Date.now();
  const unit = scheduler.allocate('east', 0.65, reticleAngle);
  send({ _cortex: { unitId: unit.id, band: scheduler.getThermalBand().name, thermalPct: scheduler.thermalPct } });

  try {
    const model  = reqModel || await detectLargestModel();
    const numCtx = estimateContextWindow(model);

    // GPU-analóg throttling: hőmérséklet szerint csökkentett paraméterek
    const { params: throttled, band, delayMs } = scheduler.throttleParams({
      temperature: 0.3, num_predict: 512, num_ctx: numCtx
    });
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));

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

    for await (const chunk of streamGenerate(model, prompt, { options: throttled })) {
      if (chunk.response) {
        fullText += chunk.response;
        send({ token: chunk.response, full: fullText });
      }
      if (chunk.done) {
        scheduler.release(unit.id, 0.65, Date.now() - t0);
        send({
          done: true, fullText: fullText.trim(), model,
          stats: { tokens: chunk.eval_count, ms: chunk.eval_duration },
          cortex: { band: band.name, thermalPct: Math.round(scheduler.thermal * 100) }
        });
        res.end();
        return;
      }
    }

    scheduler.release(unit.id, 0.65, Date.now() - t0);
    send({ done: true, fullText: fullText.trim(), model });
    res.end();
  } catch (err) {
    scheduler.release(unit.id, 0.65, Date.now() - t0);
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

// ── POST /api/decide ─────────────────────────────────────────────────────────
// Kettős réteg döntési mátrix: belső (fusion) + külső (decay) + összehasonlítás
app.post('/api/decide', (req, res) => {
  try {
    const values = req.body || {};
    const result = decisionCompute(values);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/weights ──────────────────────────────────────────────────────────
app.get('/api/weights', (_req, res) => {
  res.json(getAllWeights());
});

// ── GET /api/qr ───────────────────────────────────────────────────────────────
// QR kód generálás – minimum V1 (21×21 modul), SVG kimenet
// Query: ?data=<url> &dir=<north|east|south|west> &mode=<flexible|tight>
app.get('/api/qr', async (req, res) => {
  const { dir = 'east', data, mode = 'flexible' } = req.query;

  // Ha nincs adat, a végpont API path-ját kódoljuk
  const ep      = QR_ENDPOINTS[dir] || QR_ENDPOINTS.east;
  const baseUrl = `http://localhost:${PORT}`;
  const qrData  = data || `${baseUrl}${ep.apiPath}`;

  // Helytakarékos: Error Correction Level L = legkisebb modul szükséglet
  // Version 1 L: max 41 alphanum karakter → 21×21 modul
  const ecl = qrData.length <= 41 ? 'L' : qrData.length <= 77 ? 'M' : 'Q';

  try {
    const svg = await QRCode.toString(qrData, {
      type:            'svg',
      errorCorrectionLevel: ecl,
      margin:          0,        // nincs keret – helytakarékos
      color: { dark: ep.color, light: '#00000000' }  // átlátszó háttér
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(svg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/distance ────────────────────────────────────────────────────────
// Távolság viszonypárok kiszámítása – belső kapacitás szervezettség
app.post('/api/distance', (req, res) => {
  try {
    const { inner = {}, outer = {}, state = {}, vib = {}, adaptWeights = {} } = req.body;
    const pairs = calcDistancePairs(inner, outer, state, vib, adaptWeights);
    const orgScore = calcOrganizationScore(pairs);
    res.json({ pairs, organizationScore: orgScore, unity: orgScore });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cortex ───────────────────────────────────────────────────────────
// Cortex ütemező teljes állapota: hőtérkép, egységfa, terhelés elosztás
app.get('/api/cortex', (_req, res) => {
  res.json(scheduler.status());
});

// ── POST /api/columns ─────────────────────────────────────────────────────────
// Szerkezeti tartó oszlopok: 4 × 21 rezonáns szint, anti-deformáció szorítás
app.post('/api/columns', (req, res) => {
  try {
    const { step = 0, reticleAngle = 0, matrixEnergy = 50, tension = 0.5, distribution } = req.body;
    const columns   = calcAllColumns(step, reticleAngle, matrixEnergy, tension);
    const integrity = calcStructuralIntegrity(columns);

    let correctedDist = null;
    if (distribution) {
      correctedDist = applyAllColumnConstraints(columns, distribution, 0.48);
    }

    res.json({
      columns: columns.map(c => ({
        dir: c.dir, angle: c.angle, lambdaNm: c.lambdaNm, color: c.color, label: c.label,
        strength: c.strength, pressure: c.pressure, integrity: c.integrity,
        peakLevel: c.peakLevel, active: c.active,
        levels: c.levels.map(v => +v.toFixed(3))
      })),
      integrity,
      correctedDistribution: correctedDist
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══ ATOM LEGO KOCKA VÉGPONTOK ════════════════════════════════════════════════
// QR + internet = végtelen tömörített tartalom fogadása
// Anyba kantálás / szétbontás / zsugorítás / internet feloldás

// ── POST /api/lego/create ─────────────────────────────────────────────────────
// Új atom brick létrehozása (mini kapacitás: 4KB)
app.post('/api/lego/create', (req, res) => {
  try {
    const { payload, inetRef, level, dir, parentId } = req.body;
    if (payload == null) return res.status(400).json({ error: 'payload hiányzik' });
    const result = legoCatalog.create(payload, { inetRef, level, dir, parentId });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/lego/dock ───────────────────────────────────────────────────────
// Anyba kantálás – child brick beillesztése parentbe
app.post('/api/lego/dock', (req, res) => {
  try {
    const { childId, parentId } = req.body;
    const result = legoCatalog.dock(childId, parentId);
    if (!result) return res.status(404).json({ error: 'Brick nem található' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/lego/split ──────────────────────────────────────────────────────
// Szétbontás – egy brick n atom-kockára osztása (zsugorik)
app.post('/api/lego/split', (req, res) => {
  try {
    const { brickId, n = 2, dir } = req.body;
    const result = legoCatalog.split(brickId, n, dir);
    if (!result) return res.status(404).json({ error: 'Brick nem található' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/lego/compress ───────────────────────────────────────────────────
// QR zsugorítás – tartalom → QR URL hivatkozás (helytakarékos)
app.post('/api/lego/compress', (req, res) => {
  try {
    const { brickId } = req.body;
    const baseUrl = `http://localhost:${PORT}`;
    const result  = legoCatalog.compress(brickId, baseUrl);
    if (!result) return res.status(404).json({ error: 'Brick nem található' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/lego/resolve ────────────────────────────────────────────────────
// Internet feloldás – QR/URL → tartalom letöltés → új brick(ek) (LEGO chain)
app.post('/api/lego/resolve', async (req, res) => {
  try {
    const { brickId, doSplit = true } = req.body;
    const result = await legoCatalog.resolve(brickId, doSplit);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/lego/tree/:id? ───────────────────────────────────────────────────
// Hierarchikus brick fa lekérése
app.get('/api/lego/tree/:id?', (req, res) => {
  const tree = legoCatalog.getTree(req.params.id || null);
  if (!tree && req.params.id) return res.status(404).json({ error: 'Brick nem található' });
  res.json(tree || { empty: true });
});

// ── GET /api/lego/summary ─────────────────────────────────────────────────────
// Katalógus összesítő – teljes állapot
app.get('/api/lego/summary', (_req, res) => {
  res.json(legoCatalog.summary());
});

// ── GET /lego/:id ─────────────────────────────────────────────────────────────
// QR hivatkozás feloldó végpont (a QR kódok erre mutatnak)
app.get('/lego/:id', (req, res) => {
  const b = legoCatalog.bricks[req.params.id];
  if (!b) return res.status(404).json({ error: 'Atom brick nem található' });
  res.json(b.toJSON());
});

// ── GET /api/doctor ───────────────────────────────────────────────────────────
// GPU Dark Silicon Doctor – teljes diagnózis jelentés
app.get('/api/doctor', (_req, res) => {
  res.json(doctor.report());
});

// ── POST /api/doctor/scan ─────────────────────────────────────────────────────
// Azonnali vizsgálat indítása (nem várja a 3s-os timert)
app.post('/api/doctor/scan', (_req, res) => {
  res.json(doctor.scan());
});

// ── GET /api/slices ───────────────────────────────────────────────────────────
// Funkció szelet nyilvántartás – irányzott kis metszetek állapota
app.get('/api/slices', (_req, res) => {
  res.json(sliceRegistry.status());
});

// ── POST /api/slices/run ──────────────────────────────────────────────────────
// Egy szelet közvetlen futtatása
app.post('/api/slices/run', async (req, res) => {
  const { name, args = [] } = req.body;
  const slice = sliceRegistry.find(name);
  if (!slice) return res.status(404).json({ error: `Szelet nem található: ${name}` });
  try {
    const result = await slice.run(...args);
    res.json({ result, sliceId: slice.id, heat: slice.heat, dark: slice.isDark });
  } catch (err) {
    res.status(err.name === 'SliceDarkError' ? 503 : 500).json({
      error: err.message, sliceId: slice.id, dark: slice.isDark
    });
  }
});

// ── GET /panorama ─────────────────────────────────────────────────────────────
// Belső gömbös-spirál panoráma nézet (Three.js, holttér nélkül)
app.get('/panorama', (_req, res) => {
  const p = path.join(__dirname, '..', 'freetranslator-panorama.html');
  if (fs.existsSync(p)) res.sendFile(p);
  else res.status(404).send('Panoráma oldal nem található');
});

// ── GET /api/agy-compare ──────────────────────────────────────────────────────
// Megosztott napló (Python AGY + Java AGY összehasonlítás)
const AGY_LOG = '/tmp/agy_log.jsonl';
app.get('/api/agy-compare', (_req, res) => {
  try {
    const raw = fs.existsSync(AGY_LOG) ? fs.readFileSync(AGY_LOG, 'utf8') : '';
    const entries = raw.trim().split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    const python = entries.filter(e => e.source === 'python');
    const java   = entries.filter(e => e.source === 'java');
    res.json({
      entries,
      total: entries.length,
      python: { count: python.length, last: python[python.length-1] || null },
      java:   { count: java.length,   last: java[java.length-1] || null },
    });
  } catch (err) {
    res.json({ entries: [], total: 0, error: err.message });
  }
});

// ══ ÉZÓ AGENT AI VÉGPONTOK ══════════════════════════════════════════════════

// ── GET /api/ezo/status ───────────────────────────────────────────────────────
// Ézó Agent teljes állapota: réteg fa, byte tengely, DeepSeek modell
app.get('/api/ezo/status', (_req, res) => {
  res.json(ezoAgent.status());
});

// ── GET /api/ezo/boot ─────────────────────────────────────────────────────────
// Ézó boot: modell detektálás, gyökér + döntő réteg inicializálás
app.get('/api/ezo/boot', async (_req, res) => {
  try {
    const result = await ezoAgent.boot();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ezo/process ─────────────────────────────────────────────────────
// Fő feldolgozás: input → végtelen réteg stack → döntő réteg → DeepSeek → döntés
app.post('/api/ezo/process', async (req, res) => {
  try {
    const { input = '', matrixEnergy = 50, binaryMode = false, layers = 0 } = req.body;
    const result = await ezoAgent.process(input, { matrixEnergy, binaryMode, layers });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ezo/binary/load ─────────────────────────────────────────────────
// Bináris adat betöltése az 1-byte forgási tengelyre
app.post('/api/ezo/binary/load', (req, res) => {
  try {
    const { data = '', text } = req.body;
    const str = text || data;
    const buf  = Buffer.from(str, typeof str === 'string' ? 'utf8' : undefined);
    const result = ezoAgent.byteAxis.loadBinary(buf);
    res.json({ loaded: result, axis: ezoAgent.byteAxis.toJSON() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ezo/binary/read ─────────────────────────────────────────────────
// 1-byte forgási tengely visszaolvasása (~99% pontossággal)
app.post('/api/ezo/binary/read', (req, res) => {
  try {
    const { reticleAngle = null } = req.body;
    const result = ezoAgent.readBinary(reticleAngle);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ezo/binary/encode-decode ───────────────────────────────────────
// Szöveg → byte tengely → visszaolvasás (pontosság ellenőrzés)
app.post('/api/ezo/binary/encode-decode', (req, res) => {
  try {
    const { text = '' } = req.body;
    res.json(ezoAgent.encodeDecode(text));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ezo/layers/add ──────────────────────────────────────────────────
// Új réteg szülése a réteg fába (végtelen mélységig)
app.post('/api/ezo/layers/add', (req, res) => {
  try {
    const { parentId, dir = 'east', engineType, matrixEnergy = 50, tension, resonance } = req.body;
    const layer = ezoAgent.stack.addLayer(parentId || ezoAgent.rootId, dir, {
      engineType:    engineType || ezoAgent.engineType,
      matrixEnergy,
      tension:       tension    !== undefined ? tension    : ezoAgent.tension,
      resonance:     resonance  !== undefined ? resonance  : ezoAgent.resonance,
    });
    res.json(layer.toJSON());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ezo/reinforce ───────────────────────────────────────────────────
// Visszacsatolás: döntés erősítése/gyengítése (tanulás)
app.post('/api/ezo/reinforce', (req, res) => {
  try {
    const { dir = 'east', reward = 0.01 } = req.body;
    const weights = ezoAgent.reinforce(dir, reward);
    res.json({ reinforced: true, dir, reward, weights });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/ezo/layers ───────────────────────────────────────────────────────
// Réteg fa teljes állapota
app.get('/api/ezo/layers', (_req, res) => {
  res.json(ezoAgent.stack.status());
});

// ── GET /ezo ──────────────────────────────────────────────────────────────────
// Ézó Agent AI UI
app.get('/ezo', (_req, res) => {
  const p = path.join(__dirname, '..', 'ezo-agent.html');
  if (fs.existsSync(p)) res.sendFile(p);
  else res.status(404).send('Ézó Agent UI nem található');
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
