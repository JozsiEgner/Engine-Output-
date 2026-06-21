/**
 * Matematikai primitívek a 0-1 Roulette logikához
 * Port: mathEngine.ts → vanilla JS
 */

const GOLDEN_RATIO = (Math.sqrt(5) - 1) / 2; // ~0.6180339887
const PLASTIC_RATIO = 1.324717957244746;

function normalizeAngle(angle) {
  const mod = angle % 360;
  return mod < 0 ? mod + 360 : mod;
}

/**
 * Determinisztikus irányzék szög számítása N. lépésnél.
 * Ugyanolyan input → mindig ugyanolyan kimenet.
 */
function getReticleAngle(step, engineType, matrixEnergy) {
  const normalizedEnergy = matrixEnergy / 100;

  switch (engineType) {
    case 'weyl': {
      const fraction = (step * GOLDEN_RATIO) % 1;
      return fraction * 360;
    }
    case 'arnold': {
      const omega = GOLDEN_RATIO;
      const k = 0.5 + 2.0 * normalizedEnergy;
      let theta = 0.231;
      for (let i = 0; i < step; i++) {
        theta = (theta + omega - (k / (2 * Math.PI)) * Math.sin(2 * Math.PI * theta)) % 1;
        if (theta < 0) theta += 1;
      }
      return theta * 360;
    }
    case 'chebyshev': {
      const ratio = 1 / PLASTIC_RATIO;
      const val = Math.abs(Math.cos(step * ratio * Math.PI + normalizedEnergy * 2));
      return val * 360;
    }
    default:
      return (step * 45) % 360;
  }
}

/**
 * A lufi (0-forma) sugara adott polár-szögnél.
 * Rugalmas mag: feszültség, térfogat-megőrzés, behúzódás a reticle irányából.
 */
function getBalloonRadiusAtAngle(theta, baseRadius, reticleAngleDeg, tension, resonance, step) {
  const reticleAngleRad = (reticleAngleDeg * Math.PI) / 180;

  const harmonicCount = 4 + Math.round(resonance * 8);
  const waveAmple = 0.08 * (1 - tension);
  const breathing = Math.sin(step * 0.05) * 0.02;
  const naturalShape = baseRadius * (1 + waveAmple * Math.sin(harmonicCount * theta + step * 0.02) + breathing);

  const angleDiff = Math.atan2(Math.sin(theta - reticleAngleRad), Math.cos(theta - reticleAngleRad));
  const indentWidth = 0.45;
  const indentDepth = 0.22 * (1 - tension);
  const localDent = indentDepth * Math.exp(-(angleDiff * angleDiff) / (2 * indentWidth * indentWidth));

  const bulgeAngle1 = reticleAngleRad + Math.PI;
  const bulgeAngle2 = reticleAngleRad + Math.PI / 2;
  const bulgeAngle3 = reticleAngleRad - Math.PI / 2;

  const diff1 = Math.atan2(Math.sin(theta - bulgeAngle1), Math.cos(theta - bulgeAngle1));
  const diff2 = Math.atan2(Math.sin(theta - bulgeAngle2), Math.cos(theta - bulgeAngle2));
  const diff3 = Math.atan2(Math.sin(theta - bulgeAngle3), Math.cos(theta - bulgeAngle3));

  const bulgeWidth = 0.6;
  const bulgeValue = (indentDepth / 2) * (
    0.5 * Math.exp(-(diff1 * diff1) / (2 * bulgeWidth * bulgeWidth)) +
    0.25 * Math.exp(-(diff2 * diff2) / (2 * bulgeWidth * bulgeWidth)) +
    0.25 * Math.exp(-(diff3 * diff3) / (2 * bulgeWidth * bulgeWidth))
  );

  return Math.max(0.08, naturalShape - localDent + bulgeValue);
}

/**
 * Kardinális erőeloszlás számítása (É/K/D/Ny %).
 */
function calculateCardinalDistribution(reticleAngle, baseRadius, tension, resonance, step) {
  const reticleRad = (reticleAngle * Math.PI) / 180;

  const nRadius = getBalloonRadiusAtAngle(0, baseRadius, reticleAngle, tension, resonance, step);
  const eRadius = getBalloonRadiusAtAngle(Math.PI / 2, baseRadius, reticleAngle, tension, resonance, step);
  const sRadius = getBalloonRadiusAtAngle(Math.PI, baseRadius, reticleAngle, tension, resonance, step);
  const wRadius = getBalloonRadiusAtAngle((3 * Math.PI) / 2, baseRadius, reticleAngle, tension, resonance, step);

  const nWeight = Math.max(0, Math.cos(reticleRad - 0));
  const eWeight = Math.max(0, Math.cos(reticleRad - Math.PI / 2));
  const sWeight = Math.max(0, Math.cos(reticleRad - Math.PI));
  const wWeight = Math.max(0, Math.cos(reticleRad - (3 * Math.PI) / 2));

  let rawN = Math.max(1, nRadius * (1.0 + nWeight * 2.0) * 10);
  let rawE = Math.max(1, eRadius * (1.0 + eWeight * 2.0) * 10);
  let rawS = Math.max(1, sRadius * (1.0 + sWeight * 2.0) * 10);
  let rawW = Math.max(1, wRadius * (1.0 + wWeight * 2.0) * 10);

  const total = rawN + rawE + rawS + rawW;

  const north = Math.round((rawN / total) * 100);
  const east  = Math.round((rawE / total) * 100);
  const south = Math.round((rawS / total) * 100);
  const west  = Math.max(0, 100 - north - east - south);

  const forces = { north, east, south, west };
  let dominant = 'north';
  let maxVal = -1;
  for (const [dir, val] of Object.entries(forces)) {
    if (val > maxVal) { maxVal = val; dominant = dir; }
  }

  return { north, east, south, west, dominant };
}

/**
 * Mutató rezgés számítása – hang sebessége alapján (343 m/s)
 *
 * A mutató kar fizikai analógiában: az irányzék szög változása → ívhossz → rezgési frekvencia.
 * Kettős skála: fény (nm) a rétegekhez, hang (Hz) a mutatóhoz.
 *
 * @param {number} prevAngleDeg   előző szög (fok)
 * @param {number} currAngleDeg   jelenlegi szög (fok)
 * @param {number} armLength      kar hossza méterbem (alapértelmezett: 0.07 m = 7cm)
 * @returns {{ freqHz: number, ampNorm: number, arcM: number, wavelengthM: number, note: string }}
 */
function calcPointerVibration(prevAngleDeg, currAngleDeg, armLength = 0.07) {
  const V_SOUND = 343; // m/s

  let delta = Math.abs(currAngleDeg - prevAngleDeg);
  if (delta > 180) delta = 360 - delta; // legrövidebb ív

  const deltaRad   = delta * Math.PI / 180;
  const arcM       = armLength * deltaRad;          // ívhossz (m)
  const ampNorm    = Math.min(1.0, delta / 180);    // 0-1 amplitúdó

  // f = v / λ, félhullám-rezonancia: λ = 2 × ívhossz
  const freqHz = arcM > 0.0001 ? V_SOUND / (2 * arcM) : 0;

  // Hang hangjegy közelítés
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  let note = '–';
  if (freqHz > 20 && freqHz < 20000) {
    const midi = Math.round(69 + 12 * Math.log2(freqHz / 440));
    note = NOTE_NAMES[((midi % 12) + 12) % 12] + Math.floor(midi / 12 - 1);
  } else if (freqHz >= 20000) {
    note = 'ultraszound';
  } else {
    note = 'infraszound';
  }

  return {
    freqHz:     Math.round(freqHz),
    ampNorm,
    arcM:       +arcM.toFixed(5),
    wavelengthM: arcM > 0 ? +(2 * arcM).toFixed(5) : 0,
    note
  };
}

/**
 * Dinamikus alapátmérő számítása – sávos/aberrált módban.
 *
 * Módok:
 *   static     – rögzített átmérő (default 0.48)
 *   dynamic    – szinuszos oszcilláció lépésenként
 *   aberrated  – nem-lineáris, több-harmonikus tágulás (korlátlan mozgás)
 *
 * Az aberrált módban a burok különböző szögű sávjai különböző fázisban tágulnak,
 * ezért az átmérő polárszögtől is függ → true aberráció.
 */
function getDynamicBaseRadius(step, matrixEnergy, mode = 'static', theta = 0) {
  const e = matrixEnergy / 100;
  const t = step / 80; // normalizált idő

  if (mode === 'static') return 0.48;

  if (mode === 'dynamic') {
    return 0.32 + 0.20 * Math.abs(Math.sin(t * Math.PI + e * Math.PI));
  }

  if (mode === 'aberrated') {
    // Polárszög-függő sávos tágulás – különböző "fény-sávok" eltérő fázisban
    const bandPhase = Math.sin(4 * theta) * 0.5 + 0.5; // 0-1, szögenként változó
    return 0.28
      + 0.14 * Math.abs(Math.sin(t * Math.PI * GOLDEN_RATIO + theta))
      + 0.10 * Math.abs(Math.sin(t * Math.PI * PLASTIC_RATIO + e * Math.PI))
      + 0.06 * bandPhase * Math.abs(Math.sin(t * 2 * Math.PI + 4 * theta));
  }

  return 0.48;
}

/**
 * Aberrált sávos ballonsugar – az alap átmérő is dinamikus és szögfüggő.
 */
function getBalloonRadiusAberrated(theta, step, matrixEnergy, reticleAngleDeg, tension, resonance, mode = 'static') {
  const dynamicBase = getDynamicBaseRadius(step, matrixEnergy, mode, theta);
  return getBalloonRadiusAtAngle(theta, dynamicBase, reticleAngleDeg, tension, resonance, step);
}

export {
  GOLDEN_RATIO, PLASTIC_RATIO,
  normalizeAngle, getReticleAngle,
  getBalloonRadiusAtAngle, calculateCardinalDistribution,
  calcPointerVibration, getDynamicBaseRadius, getBalloonRadiusAberrated
};
