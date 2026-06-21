/**
 * GPU Dark Silicon Doctor
 *
 * Valódi GPU dark silicon analógia:
 *   Egy modern chip tranzisztorait nem lehet egyszerre mind bekapcsolni
 *   (teljesítmény/hőkorlát). A "sötét" területek clock-gate-elve maradnak.
 *   A "doktor" dönti el: melyik marad sötét, melyik ébred fel, mikor és hogyan.
 *
 * Ebben a rendszerben:
 *   Sötét egység  = CortexUnit amelynek heat > DARK_THRESHOLD (KRITIKUS sávban)
 *   Árnyék egység = tartalék egység, mindig hűvös, azonnal átveheti a terhet
 *   Diagnózis     = rendszeres vizsgálat: mi sötét, mi ébredhet, mi hibernáljon
 *   Recept        = konkrét utasítás az állapotváltozásra
 *
 * @module dark-silicon-doctor
 */

'use strict';

const DARK_THRESHOLD   = 0.80;   // heat > ennél = sötét (KRITIKUS sáv határa)
const WAKE_THRESHOLD   = 0.35;   // heat < ennél = újraébreszthető
const HIBERNATE_LIMIT  = 5;      // ennyi diagnózis után tartósan sötét → hibernálás
const SCAN_INTERVAL_MS = 3000;   // automatikus vizsgálat periódusa

// ── Diagnózis típusok ─────────────────────────────────────────────────────────
const RX = {
  COOL:       'RX_COOL',       // hűts tovább, ne kapj új feladatot
  SHADOW:     'RX_SHADOW',     // irányítsd át az árnyék egységre
  HIBERNATE:  'RX_HIBERNATE',  // teljesen lekapcsol, árnyék veszi át tartósan
  WAKE:       'RX_WAKE',       // elég hűvös, visszahozható forgalomba
  HEALTHY:    'RX_HEALTHY',    // rendben, nincs teendő
};

// ── DarkRecord – sötétségi napló egy egységre ─────────────────────────────────
class DarkRecord {
  constructor(unitId) {
    this.unitId       = unitId;
    this.darkCount    = 0;     // hányszor volt sötét
    this.totalDarkMs  = 0;     // összesen sötétben töltött ms
    this.lastDarkAt   = null;
    this.lastWakeAt   = null;
    this.hibernated   = false;
    this.currentRx    = RX.HEALTHY;
  }

  markDark() {
    this.darkCount++;
    this.lastDarkAt = Date.now();
  }

  markWake() {
    if (this.lastDarkAt) {
      this.totalDarkMs += Date.now() - this.lastDarkAt;
    }
    this.lastWakeAt = Date.now();
    this.currentRx  = RX.HEALTHY;
  }

  toJSON() {
    return {
      unitId:      this.unitId,
      darkCount:   this.darkCount,
      totalDarkMs: this.totalDarkMs,
      hibernated:  this.hibernated,
      currentRx:   this.currentRx,
    };
  }
}

// ── GpuDarkSiliconDoctor ──────────────────────────────────────────────────────
class GpuDarkSiliconDoctor {
  /**
   * @param {object} scheduler – CortexScheduler példány
   * @param {object} shadowRegistry – ShadowRegistry példány
   */
  constructor(scheduler, shadowRegistry) {
    this.scheduler      = scheduler;
    this.shadows        = shadowRegistry;
    this.records        = {};   // unitId → DarkRecord
    this.scanCount      = 0;
    this.lastScan       = null;
    this.prescriptions  = [];   // utolsó 20 recept
    this._timer         = null;
  }

  // ── Automatikus vizsgálat ───────────────────────────────────────────────────

  startAutoScan() {
    if (this._timer) return;
    this._timer = setInterval(() => this.scan(), SCAN_INTERVAL_MS);
  }

  stopAutoScan() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  // ── Fő vizsgálat (scan) ───────────────────────────────────────────────────

  scan() {
    this.scanCount++;
    this.lastScan = Date.now();

    const units   = Object.values(this.scheduler.units);
    const results = [];

    for (const unit of units) {
      const rec = this._record(unit.id);
      const rx  = this._diagnose(unit, rec);
      rec.currentRx = rx;

      if (rx === RX.COOL || rx === RX.SHADOW || rx === RX.HIBERNATE) {
        rec.markDark();
      } else if (rx === RX.WAKE) {
        rec.markWake();
      }

      if (rx !== RX.HEALTHY) {
        this._prescribe(unit, rx);
        results.push({ unitId: unit.id, type: unit.type, heat: unit.heat, rx });
      }
    }

    return {
      scanId:    this.scanCount,
      ts:        this.lastScan,
      units:     units.length,
      dark:      results.filter(r => r.rx === RX.SHADOW || r.rx === RX.HIBERNATE || r.rx === RX.COOL).length,
      waking:    results.filter(r => r.rx === RX.WAKE).length,
      darkRatio: units.length ? results.filter(r => r.rx !== RX.HEALTHY && r.rx !== RX.WAKE).length / units.length : 0,
      actions:   results,
    };
  }

  // ── Egység diagnózis ──────────────────────────────────────────────────────

  _diagnose(unit, rec) {
    if (!unit.active) return RX.HIBERNATE;

    if (unit.heat >= DARK_THRESHOLD) {
      if (rec.darkCount >= HIBERNATE_LIMIT) return RX.HIBERNATE;
      if (this.shadows.hasCoolShadow(unit.type)) return RX.SHADOW;
      return RX.COOL;
    }

    if (unit.heat < WAKE_THRESHOLD && rec.hibernated) return RX.WAKE;

    return RX.HEALTHY;
  }

  // ── Recept végrehajtása ───────────────────────────────────────────────────

  _prescribe(unit, rx) {
    const entry = { ts: Date.now(), unitId: unit.id, rx, heat: +unit.heat.toFixed(3) };

    switch (rx) {
      case RX.COOL:
        // Mesterséges lassítás: ne kapjon több feladatot (passive cooling)
        unit.load = Math.max(0, unit.load - 0.05);
        break;

      case RX.SHADOW:
        // Átirányítás az árnyék egységre
        this.shadows.activate(unit.type, unit.id);
        entry.shadowId = this.shadows.getActive(unit.type)?.id;
        break;

      case RX.HIBERNATE:
        // Teljes hibernálás – kikapcsol
        unit.active = false;
        this._record(unit.id).hibernated = true;
        entry.hibernated = true;
        break;

      case RX.WAKE:
        // Felébresztés – visszakapcsol
        unit.active = true;
        this._record(unit.id).hibernated = false;
        break;
    }

    this.prescriptions.unshift(entry);
    if (this.prescriptions.length > 20) this.prescriptions.pop();
  }

  // ── Segédek ───────────────────────────────────────────────────────────────

  _record(unitId) {
    if (!this.records[unitId]) this.records[unitId] = new DarkRecord(unitId);
    return this.records[unitId];
  }

  /** Egységenkénti sötétség-arány (0 = sosem sötét, 1 = mindig sötét) */
  darkRatioOf(unitId) {
    const r = this.records[unitId];
    if (!r || r.darkCount === 0) return 0;
    return +(r.totalDarkMs / Math.max(1, Date.now() - (r.lastWakeAt || Date.now()))).toFixed(4);
  }

  /** Teljes rendszer állapot-jelentés */
  report() {
    const lastScan = this.scan(); // friss vizsgálat
    const units    = Object.values(this.scheduler.units);

    return {
      doctor:      'GpuDarkSiliconDoctor',
      scanCount:   this.scanCount,
      ts:          Date.now(),
      system: {
        totalUnits:    units.length,
        activeUnits:   units.filter(u => u.active).length,
        darkUnits:     units.filter(u => u.heat >= DARK_THRESHOLD).length,
        hibernated:    units.filter(u => !u.active).length,
        avgHeat:       +(units.reduce((s, u) => s + u.heat, 0) / Math.max(1, units.length)).toFixed(4),
        darkRatio:     lastScan.darkRatio,
      },
      shadows:     this.shadows.status(),
      lastScan,
      prescriptions: this.prescriptions.slice(0, 10),
      records:     Object.values(this.records).map(r => r.toJSON()),
    };
  }
}

// ── ShadowRegistry – Árnyék egységek nyilvántartása ──────────────────────────
// (szorosan kapcsolódik a Doktorhoz, de külön kezelhető)

class ShadowRegistry {
  constructor() {
    this.shadows = {};    // type → ShadowUnit[]
    this.active  = {};    // type → aktívan futó árnyék id
  }

  /** Árnyék egység létrehozása (mindig hideg, tartalék állapotban) */
  createShadow(type) {
    if (!this.shadows[type]) this.shadows[type] = [];
    const shadow = {
      id:        `SHD-${type}-${this.shadows[type].length + 1}`,
      type,
      heat:      0,
      load:      0,
      active:    false,    // nem fut, amíg nem aktiválják
      mirroring: null,     // melyik primary-t tükrözi
      calls:     0,
      born:      Date.now(),
    };
    this.shadows[type].push(shadow);
    return shadow;
  }

  hasCoolShadow(type) {
    return (this.shadows[type] || []).some(s => !s.active && s.heat < 0.30);
  }

  activate(type, primaryId) {
    const cool = (this.shadows[type] || []).find(s => !s.active && s.heat < 0.30);
    if (!cool) return null;
    cool.active    = true;
    cool.mirroring = primaryId;
    this.active[type] = cool.id;
    return cool;
  }

  getActive(type) {
    const id = this.active[type];
    return (this.shadows[type] || []).find(s => s.id === id) || null;
  }

  deactivate(type) {
    const s = this.getActive(type);
    if (s) { s.active = false; s.mirroring = null; }
    delete this.active[type];
  }

  /** Árnyék hőszabályozás – aktív árnyékok lassan felmelegednek */
  tick() {
    for (const list of Object.values(this.shadows)) {
      for (const s of list) {
        if (s.active) {
          s.heat  = Math.min(1, s.heat + 0.04);
          s.calls++;
        } else {
          // Passzív hűlés – árnyék pihen
          s.heat = Math.max(0, s.heat - 0.06);
        }
      }
    }
  }

  status() {
    const all = Object.values(this.shadows).flat();
    return {
      total:    all.length,
      active:   all.filter(s => s.active).length,
      cool:     all.filter(s => !s.active && s.heat < 0.30).length,
      byType:   Object.fromEntries(
        Object.entries(this.shadows).map(([t, list]) => [t, {
          count:  list.length,
          active: list.filter(s => s.active).length,
          avgHeat: +(list.reduce((a, s) => a + s.heat, 0) / Math.max(1, list.length)).toFixed(3),
        }])
      ),
    };
  }
}

// ── Singletonok ───────────────────────────────────────────────────────────────

// A ShadowRegistry-t a Cortex importálja; a Doktort a szerver.
// Így: server.js → doctor.report(), scheduler a shadows.tick()-et hívja.

module.exports = {
  GpuDarkSiliconDoctor,
  ShadowRegistry,
  DarkRecord,
  RX,
  DARK_THRESHOLD,
  WAKE_THRESHOLD,
};
