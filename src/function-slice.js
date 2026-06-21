/**
 * Funkció Szelet – Irányzott logika kis metszetek
 *
 * Elvek:
 *   • Minden szelet = EGY funkció, EGY irány, minimális lábnyom
 *   • Tiszta (pure): nincs mellékhatás, kivéve a saját heat-je
 *   • Irányzott: É/K/D/Ny alapján más kognitív doménben fut
 *   • Sötét-biztos: ha a szelet sötét → árnyék szelet veszi át
 *   • Kis metszet: 4KB belső kapacitás (Atom LEGO elvéhez igazodik)
 *
 * Irány → kognitív domén:
 *   É (north):  kérdés, elemzés, értelmezés
 *   K (east):   fordítás, transzformáció, cselekvés
 *   D (south):  döntés, lezárás, szintézis
 *   Ny (west):  tanulás, memória, kontextus-tárolás
 *
 * @module function-slice
 */

'use strict';

const SLICE_CAPACITY = 4096;    // 4KB – Atom LEGO mini kapacitáshoz igazítva
const DARK_HEAT      = 0.80;    // ennél melegebb → sötét szelet
const COOL_HEAT      = 0.25;    // ennél hűvösebb → újraaktiválható

const DIRECTION_DOMAINS = {
  north: { label: 'Kérdés / Elemzés',    color: '#78c4ff', cogLoad: 0.4 },
  east:  { label: 'Fordítás / Cselekvés', color: '#8be28b', cogLoad: 0.6 },
  south: { label: 'Döntés / Szintézis',  color: '#ff9b9b', cogLoad: 0.5 },
  west:  { label: 'Tanulás / Kontextus', color: '#d7a7ff', cogLoad: 0.3 },
};

let _sliceCounter = 0;

// ── FunctionSlice – egyetlen irányzott funkció ────────────────────────────────

class FunctionSlice {
  /**
   * @param {string}   name  – funkció neve (pl. 'weyl-angle', 'tokenize')
   * @param {string}   dir   – 'north'|'east'|'south'|'west'
   * @param {Function} fn    – maga a szelet: (...args) => result
   * @param {object}   opts
   *   opts.shadow  {FunctionSlice}  – árnyék szelet (opcionális)
   *   opts.timeout {number}         – max futási idő ms-ban (default: 2000)
   *   opts.pure    {boolean}        – true: eredmény cache-elhető (default: false)
   */
  constructor(name, dir, fn, opts = {}) {
    this.id      = `FS-${String(++_sliceCounter).padStart(3, '0')}-${dir.slice(0, 1).toUpperCase()}`;
    this.name    = name;
    this.dir     = dir in DIRECTION_DOMAINS ? dir : 'east';
    this.domain  = DIRECTION_DOMAINS[this.dir];
    this.fn      = fn;
    this.shadow  = opts.shadow  || null;
    this.timeout = opts.timeout || 2000;
    this.pure    = opts.pure    || false;

    // Futási metrikák
    this.heat    = 0;       // 0–1, felmelegedés
    this.calls   = 0;
    this.errors  = 0;
    this.totalMs = 0;
    this.born    = Date.now();
    this.lastRun = null;
    this._cache  = this.pure ? new Map() : null;
  }

  /** Sötét-e a szelet? (heat > DARK_HEAT) */
  get isDark() { return this.heat >= DARK_HEAT; }

  /** Hívható-e? (nem sötét, vagy van árnyéka) */
  get callable() { return !this.isDark || (this.shadow && !this.shadow.isDark); }

  // ── Futtatás ────────────────────────────────────────────────────────────────

  /**
   * A szelet meghívása.
   * Ha sötét → árnyék szelet fut (ha van).
   * Ha nincs árnyék és sötét → SliceDarkError dobódik.
   */
  async run(...args) {
    // Sötét átirányítás
    if (this.isDark) {
      if (this.shadow && !this.shadow.isDark) {
        return this.shadow.run(...args);
      }
      throw new SliceDarkError(this);
    }

    // Cache hit (tiszta szeleteknél)
    if (this._cache) {
      const key = JSON.stringify(args);
      if (this._cache.has(key)) return this._cache.get(key);
    }

    const t0 = Date.now();
    this.calls++;
    this.lastRun = t0;

    // Hőnövekedés: a domén kognitív terhelésével arányos
    this.heat = Math.min(1, this.heat + this.domain.cogLoad * 0.08);

    try {
      // Timeout biztosítás
      const result = await Promise.race([
        Promise.resolve(this.fn(...args)),
        new Promise((_, rej) =>
          setTimeout(() => rej(new SliceTimeoutError(this)), this.timeout)
        )
      ]);

      const ms = Date.now() - t0;
      this.totalMs += ms;

      if (this._cache) {
        const key = JSON.stringify(args);
        this._cache.set(key, result);
        if (this._cache.size > 64) {
          // LRU: legrégebbi törlése
          this._cache.delete(this._cache.keys().next().value);
        }
      }

      return result;

    } catch (err) {
      this.errors++;
      // Hibánál extra hő (stressz-reakció)
      this.heat = Math.min(1, this.heat + 0.12);
      throw err;

    } finally {
      // Passzív hűlés: időarányos
      const elapsed = Date.now() - t0;
      setTimeout(() => {
        this.heat = Math.max(0, this.heat - Math.min(0.05, elapsed / 20000));
      }, 500);
    }
  }

  /** Kézi hűtés (pl. Doctor által előírt) */
  cool(amount = 0.10) {
    this.heat = Math.max(0, this.heat - amount);
  }

  /** Árnyék szelet párosítása */
  pairShadow(shadowSlice) {
    this.shadow = shadowSlice;
    return this;
  }

  toJSON() {
    return {
      id:      this.id,
      name:    this.name,
      dir:     this.dir,
      domain:  this.domain.label,
      color:   this.domain.color,
      heat:    +this.heat.toFixed(3),
      dark:    this.isDark,
      calls:   this.calls,
      errors:  this.errors,
      avgMs:   this.calls ? +(this.totalMs / this.calls).toFixed(1) : 0,
      hasShadow: !!this.shadow,
      shadowDark: this.shadow?.isDark ?? null,
    };
  }
}

// ── Hibaosztályok ─────────────────────────────────────────────────────────────

class SliceDarkError extends Error {
  constructor(slice) {
    super(`Szelet sötét: ${slice.id} (${slice.name}) heat=${slice.heat.toFixed(2)}`);
    this.sliceId = slice.id;
    this.heat    = slice.heat;
  }
}

class SliceTimeoutError extends Error {
  constructor(slice) {
    super(`Szelet túllépte a ${slice.timeout}ms határt: ${slice.id}`);
    this.sliceId = slice.id;
  }
}

// ── SliceRegistry – az összes szelet nyilvántartása ───────────────────────────

class SliceRegistry {
  constructor() {
    this.slices = {};   // id → FunctionSlice
  }

  /** Szelet regisztrálása és visszaadása */
  register(name, dir, fn, opts = {}) {
    const slice = new FunctionSlice(name, dir, fn, opts);
    this.slices[slice.id] = slice;
    return slice;
  }

  /** Szelet keresése név alapján */
  find(name) {
    return Object.values(this.slices).find(s => s.name === name) || null;
  }

  /** Iránya szerinti szeletek */
  byDir(dir) {
    return Object.values(this.slices).filter(s => s.dir === dir);
  }

  /** Sötét szeletek listája */
  dark() {
    return Object.values(this.slices).filter(s => s.isDark);
  }

  /** Hívható szeletek (nem sötét, vagy van árnyéka) */
  callable() {
    return Object.values(this.slices).filter(s => s.callable);
  }

  /** Rendszer összesített hő */
  systemHeat() {
    const all = Object.values(this.slices);
    return all.length ? +(all.reduce((s, sl) => s + sl.heat, 0) / all.length).toFixed(4) : 0;
  }

  /** Teljes állapot */
  status() {
    const all = Object.values(this.slices);
    return {
      total:      all.length,
      dark:       all.filter(s => s.isDark).length,
      callable:   all.filter(s => s.callable).length,
      systemHeat: this.systemHeat(),
      byDir: Object.fromEntries(
        ['north', 'east', 'south', 'west'].map(d => {
          const ds = all.filter(s => s.dir === d);
          return [d, {
            count: ds.length,
            dark:  ds.filter(s => s.isDark).length,
            avgHeat: ds.length ? +(ds.reduce((a,s)=>a+s.heat,0)/ds.length).toFixed(3) : 0,
          }];
        })
      ),
      slices: all.map(s => s.toJSON()),
    };
  }
}

// ── Beépített szeletek – a FreeTranslator belső funkciói ──────────────────────
// Minden szelet: egy feladat, egy irány, minimális lábnyom

const registry = new SliceRegistry();

// É – kérdés / elemzés szeletek
const sliceWeyl = registry.register('weyl-angle', 'north',
  (seed, step) => (seed + step * ((Math.sqrt(5)-1)/2)) % 1.0 * 360,
  { pure: false }
);

const sliceArnold = registry.register('arnold-map', 'north',
  (x, y, n) => {
    for (let i = 0; i < (n % 7) + 1; i++) { [x, y] = [(x+y)%1, (x+2*y)%1]; }
    return { x: +x.toFixed(4), y: +y.toFixed(4) };
  },
  { pure: false }
);

// K – fordítás / transzformáció szeletek
const sliceTokenEstimate = registry.register('token-estimate', 'east',
  (text) => Math.ceil(text.length / 4),
  { pure: true, timeout: 50 }
);

const slicePromptBuild = registry.register('prompt-build', 'east',
  (text, from, to, angle, step) =>
    `Fordítsd ${from}→${to}. [⊕${angle?.toFixed(0)||0}° ⟳${step}]\n${text}`,
  { pure: false }
);

// D – döntés / szintézis szeletek
const sliceDominant = registry.register('dominant-dir', 'south',
  (distribution) => {
    const dirs = ['north', 'east', 'south', 'west'];
    return dirs.reduce((a, b) => (distribution[a]||0) >= (distribution[b]||0) ? a : b);
  },
  { pure: true, timeout: 50 }
);

const sliceAnomaly = registry.register('anomaly-detect', 'south',
  (resonance, threshold = 0.15) => Math.abs(resonance) < threshold,
  { pure: true, timeout: 50 }
);

// Ny – tanulás / kontextus szeletek
const sliceCompressRatio = registry.register('compress-ratio', 'west',
  (original, compressed) => +(original.length / Math.max(1, compressed.length)).toFixed(2),
  { pure: true, timeout: 50 }
);

const sliceChebyshev = registry.register('chebyshev-t', 'west',
  (x, n) => {
    let [a, b] = [1, x];
    for (let i = 1; i < n; i++) [a, b] = [b, 2*x*b - a];
    return n === 0 ? 1 : n === 1 ? x : Math.max(-1, Math.min(1, b));
  },
  { pure: false, timeout: 100 }
);

// Árnyék párosítások – minden fő szeletnek van egy árnyéka ugyanolyan funkcióval
const shadowWeyl = registry.register('weyl-angle-shadow', 'north',
  sliceWeyl.fn, { pure: false }
);
sliceWeyl.pairShadow(shadowWeyl);

const shadowTokenEstimate = registry.register('token-estimate-shadow', 'east',
  sliceTokenEstimate.fn, { pure: true, timeout: 50 }
);
sliceTokenEstimate.pairShadow(shadowTokenEstimate);

module.exports = {
  FunctionSlice,
  SliceRegistry,
  SliceDarkError,
  SliceTimeoutError,
  registry,
  DIRECTION_DOMAINS,
  DARK_HEAT,
  COOL_HEAT,
  // Named slice exports
  sliceWeyl, sliceArnold,
  sliceTokenEstimate, slicePromptBuild,
  sliceDominant, sliceAnomaly,
  sliceCompressRatio, sliceChebyshev,
};
