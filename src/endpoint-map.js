/**
 * Endpoint térkép – 4 fő irányhoz rendelt végpontok
 * KULCS-04 / AI szemantikai szerepek
 */

const ENDPOINT_MAP = {
  0: {
    angle: 0,
    key: 'north',
    label: 'Észak',
    aiRole: 'Kérdések, lekérdezések, információkérések',
    queryParam: 'dir=north',
    color: '#78c4ff',
    routeHints: ['?', 'mi', 'ki', 'mikor', 'hol', 'what', 'who', 'when', 'where', 'how']
  },
  90: {
    angle: 90,
    key: 'east',
    label: 'Kelet',
    aiRole: 'Fordítás, transzformáció, konverzió, nyelvfeldolgozás',
    queryParam: 'dir=east',
    color: '#8be28b',
    routeHints: ['fordít', 'translat', 'convert', 'transform', 'átír', 'change']
  },
  180: {
    angle: 180,
    key: 'south',
    label: 'Dél',
    aiRole: 'Döntések, következtetések, válaszok, kijelentések',
    queryParam: 'dir=south',
    color: '#ff9b9b',
    routeHints: ['igen', 'nem', 'yes', 'no', 'döntés', 'decision', 'answer', 'válasz']
  },
  270: {
    angle: 270,
    key: 'west',
    label: 'Nyugat',
    aiRole: 'Tanulás, visszacsatolás, minták, önfejlesztés',
    queryParam: 'dir=west',
    color: '#d7a7ff',
    routeHints: ['tanuld', 'learn', 'remember', 'remember', 'pattern', 'feedback', 'minta']
  }
};

function getEndpoint(angle) {
  return ENDPOINT_MAP[angle] || null;
}

function getAllEndpoints() {
  return Object.values(ENDPOINT_MAP);
}

function heuristicRoute(text) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const [angle, ep] of Object.entries(ENDPOINT_MAP)) {
    scores[angle] = ep.routeHints.filter(h => lower.includes(h)).length * 20 + 10;
  }
  return scores;
}

export { ENDPOINT_MAP, getEndpoint, getAllEndpoints, heuristicRoute };
