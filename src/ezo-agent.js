/**
 * Ézó Agent AI – Geo-Matematikai Ügynök
 *
 * Architektúra:
 *   EzoLayerStack  – végtelen rétegelhetős geo-matematikai feldolgozás
 *   EzoByteAxis    – 1-byte forgási tengely (360 pozíció, 99% bináris visszaolvasás)
 *   DöntőRéteg     – 1 db végső döntő réteg (south/vörös/680nm)
 *   DeepSeekBridge – Ollama → DeepSeek 7B (vagy bármely elérhető nagy modell)
 *   DecisionMatrix – belső (fusion) + külső (decay) kettős réteg mátrix
 *
 * Feldolgozás:
 *   input → réteg stack → döntési mátrix → döntő réteg → DeepSeek → végső döntés
 *
 * Internet paraméterezés:
 *   AtomLego brickek: QR + URL → végtelen tartalom befogadás
 *   Weyl-sorozat: egyenletes lefedés garantálva
 *
 * @module ezo-agent
 */

'use strict';

const { EzoLayerStack }    = require('./ezo-layer.js');
const { EzoByteAxis }      = require('./ezo-byte-axis.js');
const { compute: decisionCompute, adaptWeight, getAllWeights } = require('./decision-matrix.js');
const { scheduler }        = require('./cortex-scheduler.js');
const { calcAllColumns, calcStructuralIntegrity } = require('./structural-columns.js');
const { catalog: legoCatalog } = require('./atom-lego.js');

const OLLAMA_BASE = process.env.OLLAMA_HOST || 'http://localhost:11434';
const DEEPSEEK_PREFER = ['deepseek', 'ds-coder', 'mistral', 'llama'];

// ── EzoAgent ─────────────────────────────────────────────────────────────────

class EzoAgent {
  /**
   * @param {object} opts
   *   opts.engineType  {string} – weyl|arnold|chebyshev (default: 'weyl')
   *   opts.tension     {number} – 0–1, bináris pontosság (default: 0.95)
   *   opts.resonance   {number} – 0–1, harmonikus szorzó (default: 0.5)
   *   opts.offline     {boolean} – Ollama nélkül fut (default: false)
   */
  constructor(opts = {}) {
    this.engineType  = opts.engineType || 'weyl';
    this.tension     = opts.tension    ?? 0.95;
    this.resonance   = opts.resonance  ?? 0.5;
    this.offline     = opts.offline    || process.env.OFFLINE === '1';

    // Réteg fa – végtelen de 1 döntő réteggel
    this.stack = new EzoLayerStack();
    const ids  = this.stack.init(this.engineType);
    this.rootId      = ids.rootId;
    this.decisiveId  = ids.decisiveId;

    // 1-byte forgási tengely
    this.byteAxis = new EzoByteAxis({ tension: this.tension, resonance: this.resonance });

    // DeepSeek / Ollama modell
    this.model       = null;   // auto-detektált
    this.modelReady  = false;

    // Állapot és memória
    this.step    = 0;
    this.memory  = [];   // utolsó 200 döntés
    this.booted  = Date.now();

    // Strukturális oszlopok (fény hullámhossz pillér rezonancia)
    this.columnIntegrity = 0;
  }

  // ── Inicializálás ─────────────────────────────────────────────────────────

  async boot() {
    if (!this.offline) {
      try {
        const models = await this._listModels();
        // Preferáljuk a DeepSeek modellt, ha elérhető
        let chosen = models[0]?.name || null;
        for (const pref of DEEPSEEK_PREFER) {
          const found = models.find(m => m.name.toLowerCase().includes(pref));
          if (found) { chosen = found.name; break; }
        }
        this.model      = chosen;
        this.modelReady = !!chosen;
      } catch {
        this.modelReady = false;
      }
    }

    return {
      ready:       true,
      model:       this.model,
      modelReady:  this.modelReady,
      offline:     this.offline,
      engineType:  this.engineType,
      tension:     this.tension,
      rootId:      this.rootId,
      decisiveId:  this.decisiveId,
    };
  }

  // ── Fő feldolgozás ────────────────────────────────────────────────────────

  /**
   * Egy input feldolgozása az összes rétegen keresztül.
   *
   * @param {string|object} input  – szöveg, JSON, bináris adat
   * @param {object}        opts
   *   opts.matrixEnergy {number} – 0–100
   *   opts.binaryMode   {boolean} – bináris visszaolvasás módban fut
   *   opts.layers       {number}  – hány extra réteget hozzon létre
   * @returns {EzoDecision}
   */
  async process(input, opts = {}) {
    this.step++;
    const t0           = Date.now();
    const matrixEnergy = opts.matrixEnergy ?? 50;
    const binaryMode   = opts.binaryMode   ?? false;
    const extraLayers  = Math.min(opts.layers ?? 0, 32);   // max 32 extra réteg

    // 1. Extra rétegek dinamikus szülése
    if (extraLayers > 0) {
      this._spawnLayers(extraLayers, matrixEnergy);
    }

    // 2. Réteg stack tick – az összes réteg egyetlen lépést tesz
    const layerResults = this.stack.tickAll(matrixEnergy);

    // 3. Döntő réteg (south, 680nm, vörös)
    const decisiveLayerResult = this.stack.tickDecisive(matrixEnergy);

    // 4. Bináris tengely frissítése
    this.byteAxis.tick();
    let binaryResult = null;
    if (binaryMode || typeof input === 'string') {
      const buf = Buffer.from(typeof input === 'string' ? input : JSON.stringify(input), 'utf8');
      this.byteAxis.loadBinary(buf);
      binaryResult = this.byteAxis.readBinary(decisiveLayerResult?.reticleAngle ?? 0);
    }

    // 5. Döntési mátrix: belső (fusion) + külső (decay)
    const matrixInput = {
      reticleAngle:  decisiveLayerResult?.reticleAngle ?? 0,
      matrixEnergy,
      tension:       this.tension,
      resonance:     this.resonance,
      vibFreqHz:     this._calcVibFreq(decisiveLayerResult),
      vibAmp:        0.5,
      balloonRadius: 0.48,
      contextSize:   this.memory.length,
      step:          this.step,
      north:         25, east: 25, south: 25, west: 25,
      adaptNorth: 1, adaptEast: 1, adaptSouth: 1, adaptWest: 1,
    };

    const matrixResult = decisionCompute(matrixInput);

    // 6. Strukturális oszlopok (fény pillér rezonancia)
    const columns   = calcAllColumns(this.step, decisiveLayerResult?.reticleAngle ?? 0, matrixEnergy, this.tension);
    this.columnIntegrity = calcStructuralIntegrity(columns);

    // 7. Cortex ütemező: döntő réteg allokálása
    const cortexUnit = scheduler.allocate('south', 0.6, decisiveLayerResult?.reticleAngle);

    // 8. DeepSeek / Ollama lekérdezés (ha elérhető)
    let deepseekResult = null;
    if (this.modelReady && !this.offline) {
      deepseekResult = await this._queryModel(input, matrixResult, decisiveLayerResult, matrixEnergy);
    }

    // 9. Végső döntés kombinálása
    const finalDecision = this._buildDecision({
      input, matrixEnergy, binaryMode,
      layerResults, decisiveLayerResult,
      matrixResult, binaryResult,
      deepseekResult, columns,
      cortexUnitId: cortexUnit.id,
      ms: Date.now() - t0,
    });

    scheduler.release(cortexUnit.id, 0.6, Date.now() - t0);

    // 10. Memória
    this.memory.push({ step: this.step, ts: Date.now(), decision: finalDecision.decisiveDir, confidence: finalDecision.confidence });
    if (this.memory.length > 200) this.memory.shift();

    return finalDecision;
  }

  // ── Bináris visszaolvasás ─────────────────────────────────────────────────

  /**
   * 99%-os bináris visszaolvasás a tengelyről.
   * tension ≥ 0.95 esetén garantált ≥ 99% pontosság.
   */
  readBinary(reticleAngle = null) {
    const angle = reticleAngle ?? (this.stack.decisive?.reticleAngle ?? 0);
    return this.byteAxis.readBinary(angle);
  }

  /**
   * Szöveg bináris betöltése + azonnal visszaolvasás.
   * Visszatér a pontossággal igazolt szöveggel.
   */
  encodeDecode(text) {
    const buf = Buffer.from(text, 'utf8');
    const loadResult = this.byteAxis.loadBinary(buf);
    const readResult = this.readBinary();
    return {
      original:    text,
      encoded:     loadResult,
      decoded:     readResult.text.slice(0, buf.length),
      accuracyPct: readResult.accuracyPct,
      match:       text.slice(0, 360) === readResult.text.slice(0, Math.min(text.length, 360)),
    };
  }

  // ── Réteg kezelés ─────────────────────────────────────────────────────────

  /** Rétegek dinamikus szülése a forgási irány mentén */
  _spawnLayers(count, matrixEnergy) {
    const dirs  = ['north', 'east', 'south', 'west'];
    const roots = [this.rootId, this.decisiveId];

    for (let i = 0; i < count; i++) {
      const parentId = roots[i % roots.length];
      const dir      = dirs[i % 4];
      const layer    = this.stack.addLayer(parentId, dir, {
        engineType:   i % 3 === 0 ? 'arnold' : i % 3 === 1 ? 'chebyshev' : 'weyl',
        matrixEnergy,
        tension:      this.tension,
        resonance:    this.resonance,
      });
      roots.push(layer.id);   // az új réteg is lehet szülő
    }
  }

  // ── Rezgésszámítás ────────────────────────────────────────────────────────

  _calcVibFreq(layerResult) {
    if (!layerResult) return 0;
    const V_SOUND  = 343;      // m/s
    const ARM      = 0.07;     // m
    const deltaDeg = Math.abs(layerResult.reticleAngle - (this.memory.at(-1)?.angle ?? 0));
    const delta    = Math.min(deltaDeg, 360 - deltaDeg);
    const arc      = ARM * (delta * Math.PI / 180);
    return arc > 0.0001 ? Math.round(V_SOUND / (2 * arc)) : 0;
  }

  // ── Döntés összerakása ────────────────────────────────────────────────────

  _buildDecision(ctx) {
    const dm = ctx.matrixResult;
    const dl = ctx.decisiveLayerResult;

    // Döntő irány: döntési mátrix belső réteg domináns iránya
    const decisiveDir   = dm?.inner?.dominant ?? dl?.dir ?? 'east';
    const resonance     = dm?.comparison?.resonance ?? 0;
    const confidence    = dm?.comparison?.jointConf ?? 0;
    const anomaly       = dm?.comparison?.anomaly   ?? false;

    // Fény pillér integritás befolyása
    const structuralBoost = this.columnIntegrity * 0.1;
    const finalConfidence = Math.min(1, confidence + structuralBoost);

    return {
      // Meta
      agentId:    'EzoAgent-v1',
      step:       this.step,
      ts:         Date.now(),
      ms:         ctx.ms,

      // Döntő réteg kimenet
      decisiveDir,
      confidence:     +finalConfidence.toFixed(4),
      resonance:      +resonance.toFixed(4),
      anomaly,

      // Geo-matematika
      reticleAngle:   dl?.reticleAngle ?? 0,
      matrixEnergy:   ctx.matrixEnergy,
      layerCount:     ctx.layerResults.length,
      maxDepth:       this.stack.maxDepth(),
      columnIntegrity: +this.columnIntegrity.toFixed(4),

      // Döntési mátrix részletek
      inner:     dm?.inner     ?? null,
      outer:     dm?.outer     ?? null,
      verdict:   dm?.comparison?.verdict ?? '',

      // Bináris tengely
      binary:    ctx.binaryResult,

      // DeepSeek értelmezés
      ai:        ctx.deepseekResult,

      // Cortex
      cortexUnit: ctx.cortexUnitId,
      thermal:    +scheduler.thermal.toFixed(4),
    };
  }

  // ── Ollama / DeepSeek ─────────────────────────────────────────────────────

  async _queryModel(input, matrixResult, layerResult, matrixEnergy) {
    const prompt = this._buildPrompt(input, matrixResult, layerResult, matrixEnergy);
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          model:  this.model,
          prompt,
          stream: false,
          options: { temperature: 0.35, num_predict: 256, num_ctx: 4096 }
        }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
      });
      if (!res.ok) return { error: `HTTP ${res.status}`, model: this.model };
      const data = await res.json();
      return {
        model:    this.model,
        text:     (data.response || '').trim(),
        tokens:   data.eval_count,
        ms:       Math.round((data.eval_duration || 0) / 1e6),
      };
    } catch (err) {
      return { error: err.message, model: this.model };
    }
  }

  _buildPrompt(input, matrixResult, layerResult, matrixEnergy) {
    const dm   = matrixResult;
    const dl   = layerResult;
    const inputStr = typeof input === 'string' ? input : JSON.stringify(input).slice(0, 500);

    return `Te az Ézó geo-matematikai AI ügynök döntő rétege (south/680nm/vörös) vagy.
Aktuális rendszerállapot:
- Lépés: ${this.step}, Motor: ${this.engineType}, Energia: ${matrixEnergy}%
- Irányzék szög: ${(dl?.reticleAngle ?? 0).toFixed(1)}°
- Rétegszám: ${this.stack.status().activeLayers} (max mélység: ${this.stack.maxDepth()})
- Döntési mátrix: belső=${dm?.inner?.dominant ?? '?'} (${(dm?.inner?.confidence * 100 || 0).toFixed(0)}%), külső=${dm?.outer?.dominant ?? '?'} (${(dm?.outer?.dominantScore * 100 || 0).toFixed(0)}%)
- Rezonancia: ${((dm?.comparison?.resonance ?? 0) * 100).toFixed(0)}% ${dm?.comparison?.anomaly ? '⚠ DIVERGENCIA' : '✓'}
- Pillér integritás: ${(this.columnIntegrity * 100).toFixed(0)}%
- Termikus: ${(scheduler.thermal * 100).toFixed(0)}%

Feladat: "${inputStr}"

Adj EGYETLEN, 2-3 mondatos döntést/értelmezést magyar nyelven.
Formátum: [IRÁNY: ${dm?.inner?.dominant?.toUpperCase() ?? 'KELET'}] döntés szövege.
Azonnal a lényegre térj, bevezető nélkül.`;
  }

  async _listModels() {
    const res  = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined
    });
    const data = await res.json();
    return (data.models || []).sort((a, b) => (b.size || 0) - (a.size || 0));
  }

  // ── Tanulás / Adaptatív súly ─────────────────────────────────────────────

  /**
   * Visszacsatolás: ha a döntés helyes volt, erősíti a domináns irány súlyát.
   * @param {string} dir     – 'north'|'east'|'south'|'west'
   * @param {number} reward  – +0.01 (helyes) / -0.005 (helytelen)
   */
  reinforce(dir, reward = 0.01) {
    const adaptId = `adapt${dir.charAt(0).toUpperCase() + dir.slice(1)}`;
    adaptWeight(adaptId, reward);
    return getAllWeights();
  }

  // ── AtomLego: internet paraméterezés ─────────────────────────────────────

  /**
   * URL betöltése az Ézó memóriájába AtomLego brick-en keresztül.
   * A tartalom szétbontódik, bekerül a byte tengelyre és a döntési mátrixba.
   */
  async loadUrl(url, dir = 'east') {
    const brick = legoCatalog.create(`[ezo-url-ref:${this.step}]`, { inetRef: url, dir });
    const resolved = await legoCatalog.resolve(brick.brick.id, true);

    if (!resolved.error && resolved.fetched > 0) {
      // A letöltött tartalom bekerül a byte tengelyre
      const buf = Buffer.from(resolved.preview || '', 'utf8');
      this.byteAxis.loadBinary(buf);
    }

    return {
      brickId:  brick.brick.id,
      resolved,
      axisState: this.byteAxis.toJSON(),
    };
  }

  // ── Állapot ───────────────────────────────────────────────────────────────

  status() {
    return {
      agentId:    'EzoAgent-v1',
      uptime:     Date.now() - this.booted,
      step:       this.step,
      engineType: this.engineType,
      tension:    this.tension,
      resonance:  this.resonance,
      offline:    this.offline,
      model:      this.model,
      modelReady: this.modelReady,
      stack:      this.stack.status(),
      byteAxis:   this.byteAxis.toJSON(),
      memory:     { count: this.memory.length, last: this.memory.at(-1) || null },
      cortex:     { thermal: +scheduler.thermal.toFixed(4) },
      columnIntegrity: +this.columnIntegrity.toFixed(4),
      weights:    getAllWeights(),
    };
  }
}

// ── Singleton Ézó Agent ───────────────────────────────────────────────────────

const ezoAgent = new EzoAgent({
  engineType: process.env.EZO_ENGINE || 'weyl',
  tension:    parseFloat(process.env.EZO_TENSION  || '0.95'),
  resonance:  parseFloat(process.env.EZO_RESONANCE || '0.5'),
  offline:    process.env.OFFLINE === '1',
});

module.exports = { EzoAgent, ezoAgent };
