/**
 * Szerkezeti Tartó Oszlopok – Fény hullámhosszon haladó logikai pillérek
 *
 * 4 iránypillér × 21 magassági szint = 84 rezonáns elem
 *
 * Analógia: épület tartóoszlop
 *   - Alap (szint 0): legmagasabb szerkezeti erő, alacsony frekvencia
 *   - Csúcs (szint 20): legkisebb erő, legmagasabb rezonancia-frekvencia
 *   - Harmónikus sor: minden szint a fény hullámhossz alapfrekvenciájának többszöröse
 *
 * Fény hullámhossz → pillér azonosítás:
 *   É (Észak):  ~450 nm  kék  → fázisszög 231° → hideg, kérdés-irány
 *   K (Kelet):  ~530 nm  zöld → fázisszög 272° → aktív, fordítás-irány
 *   D (Dél):    ~680 nm  vörös → fázisszög 349° → meleg, döntés-irány
 *   Ny (Nyugat): ~405 nm ibolya → fázisszög 208° → mély, tanulás-irány
 *
 * Anti-deformáció:
 *   Ha a burok sugara egy pillérnél meghaladja a pillér "tartóerejét",
 *   a pillér visszahúzó erőt alkalmaz (rugalmas szorítás).
 *   Külső nyomás (magas hő/terhelés) alatt a pillér ereje NEM csökken –
 *   ellenkezőleg, rezonancia fokozódik → tartósság garantált.
 *
 * @module structural-columns
 */

'use strict';

// ── Pillér katalógus – fény hullámhossz alapján ──────────────────────────────
const COLUMN_DEFS = [
  { dir: 'north', angle:   0, lambdaNm: 450, color: '#78c4ff', label: 'É · Kék pillér'   },
  { dir: 'east',  angle:  90, lambdaNm: 530, color: '#8be28b', label: 'K · Zöld pillér'  },
  { dir: 'south', angle: 180, lambdaNm: 680, color: '#ff9b9b', label: 'D · Vörös pillér' },
  { dir: 'west',  angle: 270, lambdaNm: 405, color: '#d7a7ff', label: 'Ny · Ibolya pillér' }
];

const LEVELS      = 21;      // QR V1 modulszám → szerkezeti szintek
const C_LIGHT     = 3e8;     // m/s (fény sebessége – rezonancia alapja)
const LAMBDA_REF  = 700e-9;  // nm referencia (vörös határ normalizáláshoz)

/**
 * Egy pillér 21 szintjének rezonancia értékei.
 *
 * Szint k (0=alap, 20=csúcs):
 *   baseFreq = C_LIGHT / (lambdaNm × 1e-9)   [Hz, fény frekvencia]
 *   harmonic = baseFreq × (k + 1)             [k-adik harmonikus]
 *   phase    = 2π × harmonic × step × 1e-15   [normált fázis, időlépés]
 *   strength = cos(phase) × (1 - k/LEVELS)    [erő: alap erős, csúcs gyenge]
 *   clamped  = (strength + 1) / 2             [0–1 tartományba normálva]
 *
 * @param {number} lambdaNm   – fény hullámhossz nm-ben
 * @param {number} step       – aktuális lépésszám
 * @param {number} reticleAngle – irányzék szög (°)
 * @param {number} matrixEnergy – mátrix energia (0–100)
 * @returns {number[]} 21 elemű tömb, értékek 0–1
 */
function calcColumnLevels(lambdaNm, step, reticleAngle, matrixEnergy) {
  const baseFreq = C_LIGHT / (lambdaNm * 1e-9);  // Hz (~4.5–7.4 × 10^14)
  const energy   = matrixEnergy / 100;
  const levels   = [];

  for (let k = 0; k < LEVELS; k++) {
    const harmonic = baseFreq * (k + 1);
    // Normált fázis: lépésszám × harmonikus (1e-14 skálázás → látható oszcilláció)
    const phase    = 2 * Math.PI * (harmonic * step * 1e-14 + k * reticleAngle / 360);
    // Szerkezeti erő: alap (k=0) maximális, csúcs (k=20) minimális
    const heightWeight = 1 - (k / LEVELS) * 0.6;  // 1.0 → 0.4 (alap→csúcs)
    const raw      = Math.cos(phase) * heightWeight;
    levels.push((raw + 1) / 2);  // [−1,1] → [0,1]
  }
  return levels;
}

/**
 * Pillérerő – az összes szint rezonancia-összege normálva.
 * Külső nyomás alatt (magas energia) az erő fokozódik (tartóssági elv).
 */
function calcColumnStrength(levels, matrixEnergy) {
  const avg     = levels.reduce((s, v) => s + v, 0) / levels.length;
  const pressureBoost = 1 + (matrixEnergy / 100) * 0.35;  // nyomás → erő nő
  return Math.min(1, avg * pressureBoost);
}

/**
 * Anti-deformáció szorítás egy szögnél.
 *
 * Ha radius > maxRadius × (1 + tolerance):
 *   corrected = maxRadius + (radius - maxRadius) × (1 - columnStrength)
 * Ez "rugalmas korlát": erős pillér szinte teljesen megakadályozza az áttörést,
 * gyenge pillér enged, de nem hagyja teljesen szabadon.
 *
 * @param {number} radius         – aktuális sugár
 * @param {number} maxRadius      – pillér által megengedett maximum
 * @param {number} columnStrength – 0–1, pillér erő
 * @param {number} tolerance      – kis rugalmasság (default 0.05)
 */
function applyColumnConstraint(radius, maxRadius, columnStrength, tolerance = 0.05) {
  const limit = maxRadius * (1 + tolerance);
  if (radius <= limit) return radius;
  const excess   = radius - limit;
  const clamped  = limit + excess * (1 - columnStrength);
  return clamped;
}

/**
 * Az összes pillér rezonancia kiszámítása aktuális állapotból.
 * @returns {ColumnState[]} – 4 elemű tömb, irányonként
 */
function calcAllColumns(step, reticleAngle, matrixEnergy, tension) {
  return COLUMN_DEFS.map(def => {
    const levels   = calcColumnLevels(def.lambdaNm, step, reticleAngle, matrixEnergy);
    const strength = calcColumnStrength(levels, matrixEnergy);

    // Pillér-szög és reticle közötti szögtávolság → deformációs nyomás
    const diff     = Math.abs(((reticleAngle - def.angle) + 360) % 360);
    const angDist  = Math.min(diff, 360 - diff) / 180;  // 0=egyező, 1=ellentétes
    const pressure = angDist * (1 - tension);            // feszültség csökkenti a nyomást

    // Rezonancia csúcs szintje (a legrezonánsabb szint indexe)
    const peakLevel = levels.indexOf(Math.max(...levels));

    // Szerkezeti integritás: erő × (1 + rezonancia csúcs pozíciója / LEVELS × 0.2)
    const integrity = Math.min(1, strength * (1 + peakLevel / LEVELS * 0.2));

    return {
      ...def,
      levels,
      strength:   +strength.toFixed(4),
      pressure:   +pressure.toFixed(4),
      integrity:  +integrity.toFixed(4),
      peakLevel,
      // Aktív: ha a pillér ereje > 0.3 és reticle felé néz
      active: strength > 0.3 && angDist < 0.6
    };
  });
}

/**
 * Burokkorrekció: az összes pillér anti-deformáció szorítása.
 * A balloonRadii tömb az É/K/D/Ny szögek sugárait tartalmazza.
 *
 * @param {object[]} columns     – calcAllColumns() eredménye
 * @param {object}   distribution – { north, east, south, west } százalékok
 * @param {number}   baseR       – alapsugár
 * @returns {object}             – korrigált eloszlás
 */
function applyAllColumnConstraints(columns, distribution, baseR) {
  const dirs  = ['north', 'east', 'south', 'west'];
  const out   = { ...distribution };
  const total = dirs.reduce((s, d) => s + (distribution[d] || 25), 0);

  columns.forEach(col => {
    const dir    = col.dir;
    const rawPct = (distribution[dir] || 25);
    const rawR   = baseR * rawPct / total * 4;  // arányos sugár
    const maxR   = baseR * 1.35;               // pillér által megengedett max
    const corrR  = applyColumnConstraint(rawR, maxR, col.strength);
    // Visszakonvertálás: arányosan
    out[dir] = Math.round(rawPct * (corrR / rawR));
  });

  // Korrekció: összeg 100
  const outTotal = dirs.reduce((s, d) => s + out[d], 0);
  const diff     = 100 - outTotal;
  const maxDir   = dirs.reduce((a, b) => out[a] > out[b] ? a : b);
  out[maxDir]   += diff;

  return out;
}

/**
 * Pillér összegzett integritás-score (1 = tökéletes tartószerkezet)
 */
function calcStructuralIntegrity(columns) {
  if (!columns.length) return 0;
  return +(columns.reduce((s, c) => s + c.integrity, 0) / columns.length).toFixed(4);
}

module.exports = {
  COLUMN_DEFS, LEVELS,
  calcColumnLevels,
  calcColumnStrength,
  calcAllColumns,
  applyColumnConstraint,
  applyAllColumnConstraints,
  calcStructuralIntegrity
};
