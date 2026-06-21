/**
 * Ézó Réteg – Végtelen Rétegelhetős Feldolgozó Egység
 *
 * Minden réteg geo-matematikai motorral dolgozik:
 *   Weyl / Arnold / Chebyshev determinisztikus generátorok
 *
 * Fény sebességű szerveződés:
 *   Irányonként különböző fény hullámhossz → strukturális pillér frekvencia:
 *   É (north):  450 nm kék   – kérdés / elemzés
 *   K (east):   530 nm zöld  – cselekvés / transzformáció
 *   D (south):  680 nm vörös – döntés / szintézis  ← DÖNTŐ RÉTEG
 *   Ny (west):  405 nm ibolya – tanulás / memória
 *
 * Végtelen rétegelhetőség:
 *   embed(dir) → gyermek réteg (mélység+1), rekurzív fa
 *   A döntő réteg (south) mindig a legfelső szinten hat.
 *
 * @module ezo-layer
 */

'use strict';

const GOLDEN_RATIO  = (Math.sqrt(5) - 1) / 2;
const PLASTIC_RATIO = 1.324717957244746;
const C_LIGHT       = 3e8;      // m/s – fény sebessége

const LAMBDA_BY_DIR = {
  north: 450e-9,   // kék
  east:  530e-9,   // zöld
  south: 680e-9,   // vörös – DÖNTŐ
  west:  405e-9,   // ibolya
};

const DIR_COLOR = {
  north: '#78c4ff',
  east:  '#8be28b',
  south: '#ff9b9b',
  west:  '#d7a7ff',
};

const DIR_ROLE = {
  north: 'kérdés/elemzés',
  east:  'cselekvés/transzformáció',
  south: 'döntés/szintézis [DÖNTŐ]',
  west:  'tanulás/memória',
};

let _layerCounter = 0;

// ── Math primitívek (inline, CommonJS) ───────────────────────────────────────

function weylAngle(step, energy = 0.5) {
  return (step * GOLDEN_RATIO % 1) * 360;
}

function arnoldAngle(step, energy = 0.5) {
  const k = 0.5 + 2.0 * energy;
  let theta = 0.231;
  const n = step % 500;
  for (let i = 0; i < n; i++) {
    theta = (theta + GOLDEN_RATIO - (k / (2 * Math.PI)) * Math.sin(2 * Math.PI * theta)) % 1;
    if (theta < 0) theta += 1;
  }
  return theta * 360;
}

function chebyshevAngle(step, energy = 0.5) {
  const ratio = 1 / PLASTIC_RATIO;
  return Math.abs(Math.cos(step * ratio * Math.PI + energy * 2)) * 360;
}

function getReticleAngle(step, engineType, matrixEnergy) {
  const e = matrixEnergy / 100;
  switch (engineType) {
    case 'arnold':    return arnoldAngle(step, e);
    case 'chebyshev': return chebyshevAngle(step, e);
    default:          return weylAngle(step, e);
  }
}

// ── EzoLayer ─────────────────────────────────────────────────────────────────

class EzoLayer {
  /**
   * @param {object} opts
   *   opts.depth       {number} – mélység (0=gyökér)
   *   opts.dir         {string} – north|east|south|west
   *   opts.parentId    {string} – szülő réteg ID (null=gyökér)
   *   opts.engineType  {string} – weyl|arnold|chebyshev
   *   opts.matrixEnergy{number} – 0–100
   *   opts.tension     {number} – 0–1
   *   opts.resonance   {number} – 0–1
   */
  constructor(opts = {}) {
    this.id           = `EL-${String(++_layerCounter).padStart(4, '0')}-${(opts.dir || 'E').slice(0, 1).toUpperCase()}`;
    this.depth        = opts.depth        ?? 0;
    this.dir          = opts.dir          || 'east';
    this.parentId     = opts.parentId     || null;
    this.engineType   = opts.engineType   || 'weyl';
    this.matrixEnergy = opts.matrixEnergy ?? 50;
    this.tension      = opts.tension      ?? 0.5;
    this.resonance    = opts.resonance    ?? 0.5;

    // Fény fizika
    this.lambdaM    = LAMBDA_BY_DIR[this.dir] || LAMBDA_BY_DIR.east;
    this.baseFreqHz = C_LIGHT / this.lambdaM;      // ~4.4–7.4 × 10^14 Hz

    // Állapot
    this.step         = 0;
    this.reticleAngle = 0;
    this.heat         = 0;
    this.active       = true;
    this.isDecisive   = false;

    // Gyermek rétegek (végtelen mélységig)
    this.children = [];
    this.born     = Date.now();
  }

  /** Egy lépés elvégzése – fény sebességű fázis frissítés */
  tick(matrixEnergy) {
    if (!this.active) return null;
    this.step++;
    if (matrixEnergy !== undefined) this.matrixEnergy = matrixEnergy;

    this.reticleAngle = getReticleAngle(this.step, this.engineType, this.matrixEnergy);

    // Fény-frekvencia alapú fázis (strukturális oszlop analóg)
    const harmonic    = this.baseFreqHz * (this.depth + 1);
    const phase       = 2 * Math.PI * (harmonic * this.step * 1e-14 + this.depth * this.reticleAngle / 360);
    const freqResp    = (Math.cos(phase) + 1) / 2;   // 0–1

    // Hő növekedés (aktív feldolgozás)
    this.heat = Math.min(1, this.heat + 0.02 * (1 - freqResp));

    const result = {
      id:           this.id,
      depth:        this.depth,
      dir:          this.dir,
      role:         DIR_ROLE[this.dir],
      color:        DIR_COLOR[this.dir],
      lambdaNm:     Math.round(this.lambdaM * 1e9),
      step:         this.step,
      reticleAngle: +this.reticleAngle.toFixed(2),
      freqResponse: +freqResp.toFixed(4),
      matrixEnergy: this.matrixEnergy,
      heat:         +this.heat.toFixed(3),
      isDecisive:   this.isDecisive,
      childCount:   this.children.filter(c => c.active).length,
    };

    return result;
  }

  /**
   * Gyermek réteg szülése – végtelen mélyítés.
   * A gyermek örökli a szülő motor-típusát de más irányban dolgozhat.
   */
  embed(dir, opts = {}) {
    const child = new EzoLayer({
      depth:        this.depth + 1,
      dir:          dir || this.dir,
      parentId:     this.id,
      engineType:   opts.engineType   || this.engineType,
      matrixEnergy: opts.matrixEnergy || this.matrixEnergy,
      tension:      opts.tension      !== undefined ? opts.tension : this.tension,
      resonance:    opts.resonance    !== undefined ? opts.resonance : this.resonance,
    });
    this.children.push(child);
    return child;
  }

  /** Aktív gyermek rétegek (rekurzívan) */
  allDescendants() {
    const result = [];
    const walk = (layer) => {
      layer.children.forEach(c => {
        if (c.active) {
          result.push(c);
          walk(c);
        }
      });
    };
    walk(this);
    return result;
  }

  /** Passzív hűlés */
  cool(amount = 0.05) {
    this.heat = Math.max(0, this.heat - amount);
  }

  toJSON() {
    return {
      id:           this.id,
      depth:        this.depth,
      dir:          this.dir,
      role:         DIR_ROLE[this.dir],
      color:        DIR_COLOR[this.dir],
      lambdaNm:     Math.round(this.lambdaM * 1e9),
      engineType:   this.engineType,
      step:         this.step,
      reticleAngle: +this.reticleAngle.toFixed(2),
      matrixEnergy: this.matrixEnergy,
      tension:      this.tension,
      resonance:    this.resonance,
      heat:         +this.heat.toFixed(3),
      active:       this.active,
      isDecisive:   this.isDecisive,
      childCount:   this.children.filter(c => c.active).length,
      born:         this.born,
    };
  }
}

// ── EzoLayerStack – végtelen réteg fa kezelő ────────────────────────────────

class EzoLayerStack {
  constructor() {
    this.layers = {};   // id → EzoLayer
    this.root   = null;
    this.decisive = null;
  }

  /** Inicializálás: gyökér + döntő réteg */
  init(engineType = 'weyl') {
    const root = new EzoLayer({ depth: 0, dir: 'east', engineType });
    this.layers[root.id] = root;
    this.root = root;

    // Döntő réteg: D (south) = vörös = 680nm = döntés/szintézis
    const decisive = root.embed('south', { engineType });
    decisive.isDecisive = true;
    this.layers[decisive.id] = decisive;
    this.decisive = decisive;

    return { rootId: root.id, decisiveId: decisive.id };
  }

  /** Új réteg hozzáadása a fához */
  addLayer(parentId, dir, opts = {}) {
    const parent = this.layers[parentId] || this.root;
    const layer  = parent.embed(dir, opts);
    this.layers[layer.id] = layer;
    return layer;
  }

  /** Az összes aktív réteg egy lépése (párhuzamos tick) */
  tickAll(matrixEnergy) {
    const results = [];
    for (const layer of Object.values(this.layers)) {
      const r = layer.tick(matrixEnergy);
      if (r) results.push(r);
    }
    return results;
  }

  /** Döntő réteg aktiválása */
  tickDecisive(matrixEnergy) {
    return this.decisive ? this.decisive.tick(matrixEnergy) : null;
  }

  /** Réteg fa mélység */
  maxDepth() {
    return Math.max(0, ...Object.values(this.layers).map(l => l.depth));
  }

  status() {
    const all    = Object.values(this.layers);
    const active = all.filter(l => l.active);
    return {
      totalLayers:  all.length,
      activeLayers: active.length,
      maxDepth:     this.maxDepth(),
      rootId:       this.root?.id,
      decisiveId:   this.decisive?.id,
      avgHeat:      +(active.reduce((s, l) => s + l.heat, 0) / Math.max(1, active.length)).toFixed(4),
      layers:       all.map(l => l.toJSON()),
    };
  }
}

module.exports = {
  EzoLayer,
  EzoLayerStack,
  LAMBDA_BY_DIR,
  DIR_COLOR,
  DIR_ROLE,
  C_LIGHT,
  getReticleAngle,
};
