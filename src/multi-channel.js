/**
 * Többcsatornás polár-eloszlás – 0-1 Roulette rendszerhez
 * Port: multiChannel.ts → vanilla JS
 */

import { getBalloonRadiusAtAngle, normalizeAngle } from './math-engine.js';

/**
 * Kiszámítja a többcsatornás polár-eloszlást (4, 11 vagy 22 csatorna).
 */
function calculateMultiChannelDistribution(reticleAngle, baseRadius, tension, resonance, step, outputCount) {
  const channels = [];
  const reticleRad = (reticleAngle * Math.PI) / 180;

  for (let i = 0; i < outputCount; i++) {
    const angle = (i * 360) / outputCount;
    const angleRad = (angle * Math.PI) / 180;

    const r = getBalloonRadiusAtAngle(angleRad, baseRadius, reticleAngle, tension, resonance, step);

    const diffRad = Math.atan2(Math.sin(angleRad - reticleRad), Math.cos(angleRad - reticleRad));
    const proximity = Math.max(0, Math.cos(diffRad));

    const rawWeight = r * (1.0 + 3.0 * proximity);

    let label = `CH-${String(i + 1).padStart(2, '0')} (${angle.toFixed(1)}°)`;
    if (outputCount === 4) {
      const cardinals = ['Észak (N)', 'Kelet (E)', 'Dél (S)', 'Nyugat (W)'];
      label = `${cardinals[i]} (CH-${i + 1})`;
    }

    channels.push({ id: `ch-${i}`, angle, weight: rawWeight, state: 'standby', label, expandAllowed: true });
  }

  const scaleLimit = 2.2;
  channels.forEach((ch) => {
    ch.weight = Math.min(1.0, Math.max(0.01, ch.weight / scaleLimit));
  });

  let maxWeight = 0;
  channels.forEach((ch) => { if (ch.weight > maxWeight) maxWeight = ch.weight; });

  channels.forEach((ch) => {
    const angleRad = (ch.angle * Math.PI) / 180;
    const diffRad = Math.atan2(Math.sin(angleRad - reticleRad), Math.cos(angleRad - reticleRad));
    const isOpposite = Math.abs(diffRad) > (Math.PI * 5) / 6;

    if (ch.weight === maxWeight && maxWeight > 0.1) {
      ch.state = 'active';
    } else if (ch.weight > 0.40) {
      ch.state = 'active';
    } else if (ch.weight < 0.14 || isOpposite) {
      ch.state = 'blocked';
    } else {
      ch.state = 'standby';
    }
  });

  return channels;
}

/**
 * Domináns csatornák kibontása rekurzív gyermek-mezőkre (±12° szóródás).
 */
function expandDominantChannels(channels, expansionThreshold = 0.58) {
  return channels.map((ch) => {
    if (ch.weight >= expansionThreshold && ch.expandAllowed && ch.state === 'active') {
      const children = [-12, -4, 4, 12].map((offset, idx) => {
        const cAngle = normalizeAngle(ch.angle + offset);
        const cWeight = ch.weight * 0.75;
        return {
          id: `${ch.id}-child-${idx}`,
          angle: cAngle,
          weight: Number(cAngle.toFixed(1)) === 0 ? cWeight * 1.05 : cWeight,
          state: ch.state
        };
      });
      return { ...ch, children };
    }
    return ch;
  });
}

export { calculateMultiChannelDistribution, expandDominantChannels };
