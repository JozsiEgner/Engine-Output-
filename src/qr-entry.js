/**
 * QR belső burkolás – útvonal/teleport a legjobb adat forráshoz
 * Helytakarékos: Version 1 QR = 21×21 modul (minimum méret)
 *
 * Távolság viszonypárok: mennyire "szervezett" a belső kapacitás
 * 1 (egységpont) = tökéletes szervezettség → minden távolság → 0
 *
 * @module qr-entry
 */

'use strict';

// ── Végpont térkép – QR teleport célok ───────────────────────────────────────
const QR_ENDPOINTS = {
  north: {
    dir: 'north', angle: 0,
    label: 'Észak · Kérdés',
    apiPath: '/api/route',
    color: '#78c4ff',
    desc: 'Szemantikai lekérdezési végpont',
  },
  east: {
    dir: 'east', angle: 90,
    label: 'Kelet · Fordítás',
    apiPath: '/api/translate',
    color: '#8be28b',
    desc: 'Fordítási / transzformációs végpont',
  },
  south: {
    dir: 'south', angle: 180,
    label: 'Dél · Döntés',
    apiPath: '/api/decide',
    color: '#ff9b9b',
    desc: 'Döntési mátrix / következtetési végpont',
  },
  west: {
    dir: 'west', angle: 270,
    label: 'Nyugat · Tanulás',
    apiPath: '/api/weights',
    color: '#d7a7ff',
    desc: 'Súly-adaptáció / önfejlesztési végpont',
  }
};

/**
 * QR URL buildező – helytakarékos, rövid paraméterekkel (max ~40 char → V1 L QR)
 */
function buildQRUrl(direction, state, baseUrl = '') {
  const ep = QR_ENDPOINTS[direction];
  if (!ep) return '';
  // Rövid paraméter nevek = kevesebb modul = kisebb QR
  const p = new URLSearchParams({
    d: direction[0],               // n/e/s/w
    e: Math.round(state.matrixEnergy),
    a: Math.round(state.reticleAngle),
    s: state.step % 9999,
    m: state.engineType[0]         // w/a/c
  });
  return `${baseUrl}${ep.apiPath}?${p}`;
}

/**
 * Távolság viszonypárok – belső kapacitás szervezési mérőszámok
 *
 * "1" (egységpont): tökéletes szervezettség – a rendszer teljes belső rendet ér el
 * Minden pár egy-egy dimenzió mentén méri az eltérést.
 *
 * Mode: 'flexible' = simított, 'tight' = azonnali (feszesebb)
 */
function calcDistancePairs(inner, outer, state, vib, adaptWeights) {
  const pairs = [
    {
      id: 'fusion-decay',
      label: 'Fúzió – Bomlás',
      aLabel: 'Belső skalár',     a: +(inner.score || 0).toFixed(4),
      bLabel: 'Külső dom.score',  b: +(outer.dominantScore || 0).toFixed(4),
      mode: 'flexible',
      desc: 'A mag döntése vs a héj eloszlása közötti szinkron'
    },
    {
      id: 'angle-output',
      label: 'Reticle – Kimenet szög',
      aLabel: 'Irányzék (norm)', a: +((state.reticleAngle || 0) / 360).toFixed(4),
      bLabel: 'Belső szög (n)', b: +((inner.angleOut || 0) / 360).toFixed(4),
      mode: 'tight',
      desc: 'A fizikai mutató szög vs a fúzió kiszámolt kimeneti szöge'
    },
    {
      id: 'conf-resonance',
      label: 'Konfidencia – Rezonancia',
      aLabel: 'Fúzió konf.',     a: +(inner.confidence || 0).toFixed(4),
      bLabel: 'Réteg-rezonancia',b: +(outer.dominantScore || 0).toFixed(4),
      mode: 'flexible',
      desc: 'A belső bizonyosság vs a kettős réteg egyezése'
    },
    {
      id: 'vib-energy',
      label: 'Rezgés – Energia',
      aLabel: 'Rezgés amp.',     a: +(vib.ampNorm || 0).toFixed(4),
      bLabel: 'Mátrix energia',  b: +((state.matrixEnergy || 0) / 100).toFixed(4),
      mode: 'tight',
      desc: 'A mutató rezgési amplitúdója vs a bemeneti energia szintje'
    },
    {
      id: 'context-west',
      label: 'Kontextus – Nyugat adapt.',
      aLabel: 'Kontextus méret', a: +Math.min(1, (state.contextSize || 0) / 20).toFixed(4),
      bLabel: 'Ny-súly adapt.',  b: +Math.min(1, Math.max(0, ((adaptWeights && adaptWeights.west) || 1) - 1)).toFixed(4),
      mode: 'flexible',
      desc: 'A fordítási előzmény vs a tanulási irány önfejlesztési súlya'
    },
    {
      id: 'north-south',
      label: 'Észak – Dél egyensúly',
      aLabel: 'Észak %',  a: +((outer.distribution && outer.distribution.north) || 25) / 100,
      bLabel: 'Dél %',    b: +((outer.distribution && outer.distribution.south) || 25) / 100,
      mode: 'tight',
      desc: 'Kérdés–Döntés tengelyen az egyensúly (0 = teljes kérdés, 1 = teljes döntés)'
    },
    {
      id: 'east-west',
      label: 'Kelet – Nyugat egyensúly',
      aLabel: 'Kelet %',  a: +((outer.distribution && outer.distribution.east) || 25) / 100,
      bLabel: 'Nyugat %', b: +((outer.distribution && outer.distribution.west) || 25) / 100,
      mode: 'flexible',
      desc: 'Fordítás–Tanulás tengelyen az egyensúly'
    }
  ];

  return pairs.map(p => {
    const dist  = Math.abs(p.a - p.b);
    const unity = 1 - dist; // 1 = tökéletes szervezettség (belső kapacitás egységpontja)
    return { ...p, distance: +dist.toFixed(4), unity: +unity.toFixed(4) };
  });
}

/**
 * "Szervező egységpont" – az összes távolság átlaga
 * Ha ez → 1, a rendszer maximálisan szervezett (az összes dimenzió egybeesik)
 */
function calcOrganizationScore(pairs) {
  if (!pairs.length) return 0;
  const avgUnity = pairs.reduce((s, p) => s + p.unity, 0) / pairs.length;
  return +avgUnity.toFixed(4);
}

module.exports = { QR_ENDPOINTS, buildQRUrl, calcDistancePairs, calcOrganizationScore };
