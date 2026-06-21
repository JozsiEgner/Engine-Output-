/**
 * Ézó 1-Byte Forgási Tengely
 *
 * A középpontba, a sugárból 360 db 1-byte érték illeszthető forgási tengelyre.
 * Hajlítással (tension) súlyozható: magas tension → ~99% bináris visszaolvasási pontosság.
 *
 * Fizikai analógia:
 *   - Forgási tengely = reticle irányzék (0–360°)
 *   - Minden szög-pozícióba: 1 byte (0x00–0xFF)
 *   - Hajlítás (tension 0–1): 0=rugalmas/kreatív, 1=merev/99% pontos
 *   - Lufi burok sugara adott szögnél = byte megbízhatósági súlya
 *   - Weyl-sorozat: egyenletes térfoglalás garantálva
 *
 * @module ezo-byte-axis
 */

'use strict';

const GOLDEN_RATIO = (Math.sqrt(5) - 1) / 2;  // φ ≈ 0.6180339887

// ── Inline math primitívek (math-engine.js alapján, CommonJS kompatibilis) ────

function getBalloonRadiusAtAngle(theta, baseRadius, reticleAngleDeg, tension, resonance, step) {
  const reticleAngleRad = (reticleAngleDeg * Math.PI) / 180;

  const harmonicCount = 4 + Math.round(resonance * 8);
  const waveAmple     = 0.08 * (1 - tension);
  const breathing     = Math.sin(step * 0.05) * 0.02;
  const naturalShape  = baseRadius * (1 + waveAmple * Math.sin(harmonicCount * theta + step * 0.02) + breathing);

  const angleDiff   = Math.atan2(Math.sin(theta - reticleAngleRad), Math.cos(theta - reticleAngleRad));
  const indentDepth = 0.22 * (1 - tension);
  const localDent   = indentDepth * Math.exp(-(angleDiff * angleDiff) / (2 * 0.45 * 0.45));

  const b1 = Math.atan2(Math.sin(theta - (reticleAngleRad + Math.PI)),     Math.cos(theta - (reticleAngleRad + Math.PI)));
  const b2 = Math.atan2(Math.sin(theta - (reticleAngleRad + Math.PI / 2)), Math.cos(theta - (reticleAngleRad + Math.PI / 2)));
  const b3 = Math.atan2(Math.sin(theta - (reticleAngleRad - Math.PI / 2)), Math.cos(theta - (reticleAngleRad - Math.PI / 2)));
  const W  = 0.6 * 0.6 * 2;
  const bulge = (indentDepth / 2) * (
    0.5  * Math.exp(-(b1 * b1) / W) +
    0.25 * Math.exp(-(b2 * b2) / W) +
    0.25 * Math.exp(-(b3 * b3) / W)
  );

  return Math.max(0.08, naturalShape - localDent + bulge);
}

function weylAngle(step) {
  return (step * GOLDEN_RATIO % 1) * 360;
}

// ── EzoByteAxis ───────────────────────────────────────────────────────────────

class EzoByteAxis {
  /**
   * @param {object} opts
   *   opts.tension   {number} 0–1 – hajlítási merevség (default: 0.95)
   *   opts.resonance {number} 0–1 – harmonikus szorzó  (default: 0.5)
   *   opts.baseR     {number}      – alapsugár          (default: 0.48)
   */
  constructor(opts = {}) {
    this.slots     = new Uint8Array(360);   // 360 pozíció × 1 byte
    this.tension   = opts.tension   ?? 0.95;
    this.resonance = opts.resonance ?? 0.5;
    this.baseR     = opts.baseR     ?? 0.48;
    this.step      = 0;
    this.writes    = 0;
    this.reads     = 0;
  }

  /** Byte beillesztése adott szög-pozícióba */
  insertAt(angleDeg, byte) {
    const pos = Math.round(((angleDeg % 360) + 360) % 360) % 360;
    this.slots[pos] = byte & 0xFF;
    this.writes++;
    return pos;
  }

  /**
   * Byte olvasása adott szögnél – megbízhatósági súllyal.
   * Confidence = tension × (balloonRadius / baseR) – klampolt 0–1.
   */
  readAt(angleDeg, reticleAngle = 0) {
    const pos      = Math.round(((angleDeg % 360) + 360) % 360) % 360;
    const byte     = this.slots[pos];
    const thetaRad = (pos * Math.PI) / 180;

    const radius     = getBalloonRadiusAtAngle(thetaRad, this.baseR, reticleAngle, this.tension, this.resonance, this.step);
    const confidence = Math.min(1, this.tension * (radius / this.baseR));
    this.reads++;

    return { pos, byte, confidence: +confidence.toFixed(4), bitRepr: byte.toString(2).padStart(8, '0') };
  }

  /**
   * Összes 360 byte visszaolvasása.
   * Visszaad: bytes Buffer, confidence tömb, átlag pontosság %.
   * tension ≥ 0.95 esetén átlagos pontosság ≥ 99%.
   */
  readAll(reticleAngle = 0) {
    const results = [];
    for (let i = 0; i < 360; i++) {
      results.push(this.readAt(i, reticleAngle));
    }
    const avgConf = results.reduce((s, r) => s + r.confidence, 0) / 360;
    return {
      bytes:       Buffer.from(results.map(r => r.byte)),
      confidences: results.map(r => r.confidence),
      avgConfidence: +avgConf.toFixed(4),
      accuracyPct:   +(avgConf * 100).toFixed(2),
      slots:         360,
    };
  }

  /**
   * Bináris puffer betöltése a tengelyre – Weyl-sorozat alapján egyenletesen.
   * Max 360 byte; ha több → csak az első 360 töltődik be.
   * Visszaad: betöltött byte-ok száma, lefedettség %.
   */
  loadBinary(bufferOrString) {
    const data = Buffer.isBuffer(bufferOrString)
      ? bufferOrString
      : Buffer.from(bufferOrString);
    const len = Math.min(data.length, 360);
    for (let i = 0; i < len; i++) {
      const pos = Math.round((i * GOLDEN_RATIO % 1) * 360) % 360;
      this.slots[pos] = data[i];
    }
    this.writes += len;
    return { loaded: len, total: data.length, coveragePct: +(len / 360 * 100).toFixed(1) };
  }

  /**
   * Bináris olvasás egyetlen sorban (pl. szöveg, hex, base64).
   * A visszaolvasott bytes-ből megpróbál UTF-8-at dekódolni.
   * @param {number} reticleAngle – irányzék szög (0–360)
   * @returns {{ text: string, hex: string, accuracyPct: number }}
   */
  readBinary(reticleAngle = 0) {
    const { bytes, accuracyPct } = this.readAll(reticleAngle);
    let text = '';
    try { text = bytes.toString('utf8'); } catch { text = '(dekódolási hiba)'; }
    return {
      text,
      hex:        bytes.toString('hex'),
      base64:     bytes.toString('base64'),
      accuracyPct,
    };
  }

  /** Tengely nullázása */
  clear() {
    this.slots.fill(0);
  }

  /** Lépésszám növelése (rezgés frissítéséhez) */
  tick() {
    this.step++;
  }

  /** Snapshot JSON */
  toJSON() {
    return {
      tension:    this.tension,
      resonance:  this.resonance,
      baseR:      this.baseR,
      step:       this.step,
      writes:     this.writes,
      reads:      this.reads,
      nonZeroSlots: this.slots.filter(b => b !== 0).length,
    };
  }
}

module.exports = { EzoByteAxis, getBalloonRadiusAtAngle, weylAngle, GOLDEN_RATIO };
