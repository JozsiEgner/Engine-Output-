/**
 * Kettős réteg döntési mátrix
 *
 * Analógia: atom bomlás (decay) és egyesülés (fusion)
 *
 * BELSŐ réteg – fusion (egyesülés / mag):
 *   Minden változó → normalizált súlyPontszám → egyetlen döntő skalár → domináns irány
 *
 * KÜLSŐ réteg – decay (bomlás / héj):
 *   Minden változó kisugározódik a négy végpont felé → irányvektoros endpoint-eloszlás
 *
 * Összehasonlítás:
 *   A két réteg domináns iránya összevethetó → rezonancia / divergencia mérték
 *
 * @module decision-matrix
 */

'use strict';

// ── Változó katalógus ─────────────────────────────────────────────────────────
// layer: 'inner' | 'outer' | 'both'
// w0:    alap súlyPontszám (0–1); tanulással módosítható
// norm:  [0, max] → [0, 1] normalizáló függvény
// affinity: irányprioritás (outer layer decay súly)
const VARIABLE_CATALOG = [
  {
    id: 'reticleAngle', label: 'Irányzék szög (°)', layer: 'both', w0: 0.85,
    norm: v => v / 360,
    // szögből irány-affinitás: cos-alapú vetítés
    affinity: v => {
      const r = v * Math.PI / 180;
      return {
        north: Math.max(0, Math.cos(r)),
        east:  Math.max(0, Math.cos(r - Math.PI / 2)),
        south: Math.max(0, Math.cos(r - Math.PI)),
        west:  Math.max(0, Math.cos(r - 3 * Math.PI / 2))
      };
    }
  },
  {
    id: 'north', label: 'Észak %', layer: 'outer', w0: 0.72,
    norm: v => v / 100,
    affinity: v => ({ north: v / 100, east: 0.05, south: 0.05, west: 0.05 })
  },
  {
    id: 'east', label: 'Kelet %', layer: 'outer', w0: 0.91,
    norm: v => v / 100,
    affinity: v => ({ north: 0.05, east: v / 100, south: 0.05, west: 0.05 })
  },
  {
    id: 'south', label: 'Dél %', layer: 'outer', w0: 0.54,
    norm: v => v / 100,
    affinity: v => ({ north: 0.05, east: 0.05, south: v / 100, west: 0.05 })
  },
  {
    id: 'west', label: 'Nyugat %', layer: 'outer', w0: 0.31,
    norm: v => v / 100,
    affinity: v => ({ north: 0.05, east: 0.05, south: 0.05, west: v / 100 })
  },
  {
    id: 'matrixEnergy', label: 'Mátrix energia', layer: 'inner', w0: 0.78,
    norm: v => v / 100,
    affinity: v => {
      // Magas energia → Észak (kérdések) és Kelet (fordítás)
      const e = v / 100;
      return { north: e * 0.5, east: e * 0.4, south: (1 - e) * 0.4, west: (1 - e) * 0.2 };
    }
  },
  {
    id: 'tension', label: 'Feszültség', layer: 'inner', w0: 0.65,
    norm: v => v,
    affinity: v => ({ north: 0.1, east: 0.1, south: v * 0.7, west: (1 - v) * 0.5 })
  },
  {
    id: 'resonance', label: 'Rezonancia', layer: 'inner', w0: 0.45,
    norm: v => v,
    affinity: v => ({ north: v * 0.3, east: v * 0.5, south: v * 0.1, west: v * 0.4 })
  },
  {
    id: 'vibFreqHz', label: 'Rezgés (Hz)', layer: 'both', w0: 0.67,
    norm: v => Math.min(1, Math.log10(Math.max(1, v)) / 5),
    affinity: v => {
      const f = Math.min(1, v / 20000);
      return { north: f * 0.6, east: f * 0.3, south: (1 - f) * 0.5, west: (1 - f) * 0.3 };
    }
  },
  {
    id: 'vibAmp', label: 'Rezgés amp', layer: 'both', w0: 0.42,
    norm: v => Math.min(1, v),
    affinity: v => ({ north: v * 0.4, east: v * 0.4, south: (1 - v) * 0.3, west: (1 - v) * 0.4 })
  },
  {
    id: 'balloonRadius', label: 'Burok sugár', layer: 'inner', w0: 0.58,
    norm: v => Math.min(1, v / 0.7),
    affinity: v => {
      const r = Math.min(1, v / 0.7);
      return { north: r * 0.3, east: r * 0.5, south: (1 - r) * 0.4, west: (1 - r) * 0.3 };
    }
  },
  {
    id: 'contextSize', label: 'Kontextus méret', layer: 'both', w0: 0.38,
    norm: v => Math.min(1, v / 20),
    affinity: v => {
      const c = Math.min(1, v / 20);
      return { north: 0.1, east: c * 0.6, south: 0.05, west: c * 0.8 }; // Ny = tanulás
    }
  },
  {
    id: 'adaptNorth', label: 'Adapt É-súly', layer: 'inner', w0: 0.33,
    norm: v => Math.min(1, Math.max(0, v - 1)),
    affinity: v => ({ north: Math.max(0, v - 1), east: 0.05, south: 0.02, west: 0.02 })
  },
  {
    id: 'adaptEast', label: 'Adapt K-súly', layer: 'inner', w0: 0.48,
    norm: v => Math.min(1, Math.max(0, v - 1)),
    affinity: v => ({ north: 0.05, east: Math.max(0, v - 1), south: 0.02, west: 0.02 })
  },
  {
    id: 'adaptSouth', label: 'Adapt D-súly', layer: 'inner', w0: 0.29,
    norm: v => Math.min(1, Math.max(0, v - 1)),
    affinity: v => ({ north: 0.02, east: 0.05, south: Math.max(0, v - 1), west: 0.02 })
  },
  {
    id: 'adaptWest', label: 'Adapt Ny-súly', layer: 'inner', w0: 0.25,
    norm: v => Math.min(1, Math.max(0, v - 1)),
    affinity: v => ({ north: 0.02, east: 0.02, south: 0.02, west: Math.max(0, v - 1) })
  },
  {
    id: 'step', label: 'Lépésszám', layer: 'both', w0: 0.20,
    norm: v => Math.min(1, v / 1000),
    affinity: v => {
      const s = Math.min(1, v / 1000);
      return { north: 0.1, east: 0.1, south: s * 0.3, west: s * 0.6 }; // idő → tanulás
    }
  }
];

const DIRS = ['north', 'east', 'south', 'west'];
const DIR_LABELS = { north: 'Észak (0°)', east: 'Kelet (90°)', south: 'Dél (180°)', west: 'Nyugat (270°)' };

// ── Súlyok tanulással módosítható táblája ─────────────────────────────────────
const _weights = {};
VARIABLE_CATALOG.forEach(v => { _weights[v.id] = v.w0; });

function getWeight(id)          { return _weights[id] ?? 0.5; }
function adaptWeight(id, delta) { _weights[id] = Math.min(1, Math.max(0, (_weights[id] ?? 0.5) + delta)); }
function getAllWeights()         { return { ..._weights }; }

// ── Normalizálás és affinitás kiértékelés ────────────────────────────────────
function evalVariable(catalog, values) {
  const id  = catalog.id;
  const raw = values[id] ?? 0;
  const nv  = isFinite(catalog.norm(raw)) ? catalog.norm(raw) : 0;
  const w   = getWeight(id);
  const aff = catalog.affinity(raw);
  return { id, label: catalog.label, layer: catalog.layer, raw, normalized: +nv.toFixed(4), weight: +w.toFixed(4), affinity: aff };
}

// ── BELSŐ RÉTEG – fusion / egyesülés ─────────────────────────────────────────
/**
 * Minden változó normalizált értékét × súlyával összegzi.
 * Az összeg a [0, 360] tartományba vetítve irányszöget ad.
 * Ez a "mag" döntés – egyetlen pont.
 */
function computeInnerLayer(variables) {
  let weightedSum = 0;
  let totalWeight = 0;

  const contributions = [];

  for (const ev of variables) {
    if (ev.layer === 'outer') continue; // csak 'inner' + 'both'
    const contrib = ev.normalized * ev.weight;
    weightedSum  += contrib;
    totalWeight  += ev.weight;
    contributions.push({ id: ev.id, label: ev.label, contrib: +contrib.toFixed(5), weight: ev.weight, norm: ev.normalized });
  }

  const score       = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const angleOut    = score * 360;
  const dominant    = findDominantAngle(angleOut);
  const confidence  = Math.abs(score - 0.5) * 2; // 0 = semleges, 1 = erős

  contributions.sort((a, b) => b.contrib - a.contrib);

  return { score: +score.toFixed(6), angleOut: +angleOut.toFixed(2), dominant, confidence: +confidence.toFixed(4), contributions };
}

function findDominantAngle(angleDeg) {
  const a = ((angleDeg % 360) + 360) % 360;
  const candidates = [
    { dir: 'north', angle: 0   },
    { dir: 'east',  angle: 90  },
    { dir: 'south', angle: 180 },
    { dir: 'west',  angle: 270 }
  ];
  return candidates.reduce((best, c) => {
    const d = Math.min(Math.abs(a - c.angle), 360 - Math.abs(a - c.angle));
    const bd = Math.min(Math.abs(a - best.angle), 360 - Math.abs(a - best.angle));
    return d < bd ? c : best;
  }).dir;
}

// ── KÜLSŐ RÉTEG – decay / bomlás ─────────────────────────────────────────────
/**
 * Minden változó kisugározza az energiáját a négy végpont felé, affinity-súlyozással.
 * Az összesített végpont-energiák adják a külső réteg eloszlását.
 */
function computeOuterLayer(variables) {
  const endpointScores = { north: 0, east: 0, south: 0, west: 0 };
  const endpointWeights = { north: 0, east: 0, south: 0, west: 0 };
  const varContribs = {};

  for (const ev of variables) {
    if (ev.layer === 'inner') continue; // csak 'outer' + 'both'
    const totalAff = DIRS.reduce((s, d) => s + (ev.affinity[d] || 0), 0);
    if (totalAff === 0) continue;

    const varRow = {};
    for (const dir of DIRS) {
      const aff     = (ev.affinity[dir] || 0) / totalAff;
      const contrib = ev.normalized * ev.weight * aff;
      endpointScores[dir]  += contrib;
      endpointWeights[dir] += ev.weight;
      varRow[dir] = +contrib.toFixed(5);
    }
    varContribs[ev.id] = varRow;
  }

  // Normalizálás 0-100%
  const totalScore = DIRS.reduce((s, d) => s + endpointScores[d], 0);
  const distribution = {};
  for (const dir of DIRS) {
    distribution[dir] = totalScore > 0 ? Math.round(endpointScores[dir] / totalScore * 100) : 25;
  }

  // Korrekció: összeg legyen pontosan 100
  const corrDir = DIRS.reduce((a, b) => distribution[a] > distribution[b] ? a : b);
  distribution[corrDir] += 100 - DIRS.reduce((s, d) => s + distribution[d], 0);

  const dominant = DIRS.reduce((a, b) => distribution[a] > distribution[b] ? a : b);
  const domScore = distribution[dominant] / 100;

  return { distribution, dominant, dominantScore: +domScore.toFixed(4), rawScores: { ...endpointScores }, varContribs };
}

// ── ÖSSZEHASONLÍTÁS – rezonancia mérték ──────────────────────────────────────
/**
 * Összeméri a belső és külső réteg domináns irányát.
 * Rezonancia = 1.0 → teljes egyezés
 * Rezonancia = 0.0 → maximális divergencia (ellentétes irányok)
 */
function compareLayersResult(inner, outer) {
  const agree   = inner.dominant === outer.dominant;

  // Szögtávolság a két domináns irány között
  const ANGLES  = { north: 0, east: 90, south: 180, west: 270 };
  const iAngle  = ANGLES[inner.dominant];
  const oAngle  = ANGLES[outer.dominant];
  let angleDiff = Math.abs(iAngle - oAngle);
  if (angleDiff > 180) angleDiff = 360 - angleDiff;

  const resonance = 1 - angleDiff / 180; // 0 (ellentétes) – 1 (egyező)

  // Döntési biztonság: ha mindkét réteg magas konfidenciával ugyanoda mutat
  const fusionConf  = inner.confidence;
  const decayConf   = outer.dominantScore;
  const jointConf   = (fusionConf + decayConf) / 2;

  // Anomália: ha a két réteg ellentétesek → instabil rendszer
  const anomaly = resonance < 0.33;

  return {
    agree, resonance: +resonance.toFixed(4), angleDiff,
    fusionConf: +fusionConf.toFixed(4), decayConf: +decayConf.toFixed(4),
    jointConf: +jointConf.toFixed(4), anomaly,
    innerDominant: inner.dominant, outerDominant: outer.dominant,
    verdict: anomaly
      ? `DIVERGENCIA – belső: ${DIR_LABELS[inner.dominant]}, külső: ${DIR_LABELS[outer.dominant]}`
      : `REZONANCIA – ${DIR_LABELS[inner.dominant]} (${(resonance * 100).toFixed(0)}%)`
  };
}

// ── Fő compute függvény ───────────────────────────────────────────────────────
/**
 * @param {object} values  – minden változó aktuális értéke (id → szám)
 * @returns {DecisionResult}
 */
function compute(values) {
  const variables = VARIABLE_CATALOG.map(c => evalVariable(c, values));

  const inner      = computeInnerLayer(variables);
  const outer      = computeOuterLayer(variables);
  const comparison = compareLayersResult(inner, outer);

  // Önfejlesztés: ha a két réteg egyezik, erősítsd a domináns irány adaptációs súlyát
  if (comparison.agree && comparison.resonance > 0.7) {
    const adaptId = `adapt${inner.dominant.charAt(0).toUpperCase() + inner.dominant.slice(1)}`;
    adaptWeight(adaptId, 0.01);
  }
  // Ha divergál, csökkentsd a túl erős változók súlyát
  if (comparison.anomaly) {
    inner.contributions.slice(0, 3).forEach(c => adaptWeight(c.id, -0.005));
  }

  return {
    timestamp: Date.now(),
    variables: variables.map(v => ({
      id: v.id, label: v.label, layer: v.layer,
      raw: v.raw, normalized: v.normalized, weight: v.weight,
      weightScore: +(v.normalized * v.weight).toFixed(5)
    })),
    inner,
    outer,
    comparison,
    weights: getAllWeights()
  };
}

module.exports = { compute, adaptWeight, getAllWeights, VARIABLE_CATALOG, DIR_LABELS };
