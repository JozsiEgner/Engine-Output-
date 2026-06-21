/**
 * Cortex Dinamikus Ütemező – GPU-analóg terhelés elosztás
 *
 * Analógia: GPU warp / blokk / SM ütemező
 *   Warp   = CortexUnit  (egy feldolgozó egység, irányvektorra hangolt)
 *   Blokk  = önbeágyazott CortexUnit fa (mélység növekedhet)
 *   Shader = feladattípus (É/K/D/Ny) – reticle szög alapján
 *
 * Csúszó  – egységek fokozatosan átveszik egymás terhét (load slide)
 * Mászó   – beágyazott gyermek egységek lassan migrálnak fel/le (depth crawl)
 * Forgó   – reticle szög forgatja a feladattípus-hozzárendelést (vector rotate)
 *
 * Hőszabályzás:
 *   Thermal = EMA(egységek heat értékei)
 *   HŰVÖS < 0.30 → teljes kapacitás
 *   MELEG  0.30–0.60 → ctx×0.85, pred×0.90
 *   FORRÓ  0.60–0.80 → ctx×0.65, pred×0.70 + 80ms késleltetés
 *   KRITIKUS > 0.80  → ctx×0.40, pred×0.50 + 200ms késleltetés
 *
 * @module cortex-scheduler
 */

'use strict';

const TASK_TYPES  = ['north', 'east', 'south', 'west'];
const TASK_ANGLES = { north: 0, east: 90, south: 180, west: 270 };

const THERMAL_BANDS = [
  { name: 'COOL',     label: 'HŰVÖS',    max: 0.30, color: '#78c4ff', ctxMult: 1.00, predictMult: 1.00, delayMs: 0   },
  { name: 'WARM',     label: 'MELEG',    max: 0.60, color: '#8be28b', ctxMult: 0.85, predictMult: 0.90, delayMs: 0   },
  { name: 'HOT',      label: 'FORRÓ',    max: 0.80, color: '#ffc96b', ctxMult: 0.65, predictMult: 0.70, delayMs: 80  },
  { name: 'CRITICAL', label: 'KRITIKUS', max: 1.00, color: '#ff9b9b', ctxMult: 0.40, predictMult: 0.50, delayMs: 200 }
];

function getThermalBand(level) {
  return THERMAL_BANDS.find(b => level <= b.max) || THERMAL_BANDS[THERMAL_BANDS.length - 1];
}

// ── CortexUnit ────────────────────────────────────────────────────────────────

let _nextUnitId = 1;

class CortexUnit {
  constructor(type, depth = 0, parentId = null) {
    this.id       = `CU${String(_nextUnitId++).padStart(3, '0')}`;
    this.type     = type;
    this.depth    = depth;
    this.parentId = parentId;
    this.children = [];   // beágyazott gyermek egységek
    this.load     = 0;    // aktuális terhelés 0–1
    this.heat     = 0;    // akkumulált hő 0–1
    this.tasks    = 0;    // elvégzett feladatok száma
    this.active   = true;
    this.born     = Date.now();
    this.lastTask = null;
  }

  /** Feladat felvétele – csúszó terhelésnövelés */
  acquire(complexity) {
    this.load     = Math.min(1, this.load + complexity);
    this.heat     = Math.min(1, this.heat + complexity * 0.35);
    this.tasks++;
    this.lastTask = Date.now();
  }

  /** Feladat befejezése – hő elmaradással csökken (hőszabályzó hatás) */
  release(complexity, durationMs) {
    this.load = Math.max(0, this.load - complexity);
    // Rövid feladat kevésbé hűt – hő-kapacitás analóg
    const coolRate = complexity * 0.12 * Math.min(2, 1000 / Math.max(50, durationMs));
    this.heat = Math.max(0, this.heat - coolRate);
  }

  /** Önbeágyazás – gyermek CortexUnit szülése (mászó mélységnövekedés) */
  embed(type) {
    const child = new CortexUnit(type, this.depth + 1, this.id);
    this.children.push(child);
    return child;
  }

  toJSON() {
    return {
      id: this.id, type: this.type, depth: this.depth, parentId: this.parentId,
      load:  +this.load.toFixed(3),
      heat:  +this.heat.toFixed(3),
      tasks: this.tasks,
      active: this.active,
      childCount: this.children.filter(c => c.active).length
    };
  }
}

// ── CortexScheduler ───────────────────────────────────────────────────────────

class CortexScheduler {
  constructor() {
    this.units   = {};   // id → CortexUnit
    this.thermal = 0;    // rendszer hőmérséklet EMA
    this.log     = [];   // utolsó 20 feladat esemény

    // Alap négy egység – egy irányonként (warp-0 analóg)
    for (const t of TASK_TYPES) {
      const u = new CortexUnit(t, 0, null);
      this.units[u.id] = u;
    }
  }

  /** Reticle szög → feladattípus (forgó vektorirányzék routing) */
  angleToType(deg) {
    const a = ((deg % 360) + 360) % 360;
    return TASK_TYPES.reduce((best, t) => {
      const d  = Math.min(Math.abs(a - TASK_ANGLES[t]),   360 - Math.abs(a - TASK_ANGLES[t]));
      const bd = Math.min(Math.abs(a - TASK_ANGLES[best]), 360 - Math.abs(a - TASK_ANGLES[best]));
      return d < bd ? t : best;
    });
  }

  /**
   * Egység foglalása feladathoz.
   * Ha nincs szabad kapacitás (load > 0.85), önbeágyazás: új gyermek egység.
   */
  allocate(type, complexity = 0.5, reticleAngle = null) {
    const taskType = (reticleAngle != null) ? this.angleToType(reticleAngle) : (type || 'east');

    // Csúszó keresés: legkisebb terhelésű szabad egység azonos típusból
    const free = Object.values(this.units)
      .filter(u => u.active && u.type === taskType && u.load <= 0.85)
      .sort((a, b) => a.load - b.load);

    let unit;
    if (free.length > 0) {
      unit = free[0];
    } else {
      // Minden azonos típusú egység túlterhelt → mászó önbeágyazás
      const overloaded = Object.values(this.units)
        .filter(u => u.active && u.type === taskType)
        .sort((a, b) => b.depth - a.depth);

      if (overloaded.length > 0) {
        // Legmélyebb szinten lévő egység ágyazza be az újat
        unit = overloaded[0].embed(taskType);
        this.units[unit.id] = unit;
      } else {
        // Nincs ilyen típus → legenyhébb bármelyik
        unit = Object.values(this.units)
          .filter(u => u.active)
          .sort((a, b) => a.load - b.load)[0];
      }
    }

    unit.acquire(complexity);
    this._tick(taskType, complexity, 'acquire');
    return unit;
  }

  /** Feladat befejezése, egység hőjének visszaszabályzása */
  release(unitId, complexity = 0.5, durationMs = 500) {
    const unit = this.units[unitId];
    if (!unit) return;
    unit.release(complexity, durationMs);
    this._tick(unit.type, complexity, 'release');
    // Nem alap egység, nincs terhelés → visszavonul (hőszabályzó lehűlés)
    if (unit.depth > 0 && unit.load < 0.04 && unit.tasks > 0) {
      unit.active = false;
    }
  }

  /** EMA hőmérséklet frissítés */
  _tick(type, complexity, phase) {
    const active  = Object.values(this.units).filter(u => u.active);
    const avgHeat = active.reduce((s, u) => s + u.heat, 0) / Math.max(1, active.length);
    this.thermal  = +(this.thermal * 0.72 + avgHeat * 0.28).toFixed(4);

    this.log.push({ ts: Date.now(), type, complexity, phase });
    if (this.log.length > 20) this.log.shift();
  }

  getThermalBand() { return getThermalBand(this.thermal); }

  /**
   * GPU-analóg Ollama paraméter throttling.
   * Visszaadja a hőmérséklet-arányosan csökkentett paramétereket.
   */
  throttleParams(opts = {}) {
    const tb  = getThermalBand(this.thermal);
    const out = { ...opts };
    if (out.num_ctx)     out.num_ctx     = Math.max(512, Math.floor((out.num_ctx     || 2048) * tb.ctxMult));
    if (out.num_predict) out.num_predict = Math.max(64,  Math.floor((out.num_predict || 256)  * tb.predictMult));
    if (out.temperature) out.temperature = +(out.temperature * (tb.name === 'CRITICAL' ? 1.15 : 1.0)).toFixed(2);
    return { params: out, band: tb, delayMs: tb.delayMs };
  }

  /** Terhelés eloszlás irányonként */
  getLoadDist() {
    const dist = {};
    for (const t of TASK_TYPES) {
      const us = Object.values(this.units).filter(u => u.active && u.type === t);
      dist[t] = {
        count:   us.length,
        avgLoad: us.length ? +(us.reduce((s, u) => s + u.load, 0) / us.length).toFixed(3) : 0,
        avgHeat: us.length ? +(us.reduce((s, u) => s + u.heat, 0) / us.length).toFixed(3) : 0
      };
    }
    return dist;
  }

  getMaxDepth() {
    return Math.max(0, ...Object.values(this.units).filter(u => u.active).map(u => u.depth));
  }

  /** Teljes állapot snapshot – GET /api/cortex számára */
  status() {
    const active = Object.values(this.units).filter(u => u.active);
    const band   = getThermalBand(this.thermal);
    return {
      thermal:   this.thermal,
      thermalPct: Math.round(this.thermal * 100),
      band,
      unitCount: active.length,
      maxDepth:  this.getMaxDepth(),
      load:      this.getLoadDist(),
      units:     active.map(u => u.toJSON()),
      log:       this.log.slice(-10)
    };
  }
}

// Singleton – szerver szintű, megosztott állapot
const scheduler = new CortexScheduler();

module.exports = { CortexScheduler, CortexUnit, scheduler, getThermalBand, THERMAL_BANDS, TASK_TYPES };
