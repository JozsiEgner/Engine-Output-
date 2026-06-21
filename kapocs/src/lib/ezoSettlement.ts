/**
 * Ézó Település Motor
 *
 * Minden település halmazokat (zónákat) tartalmaz.
 * A halmazok metszetek által kapcsolódnak a polgárokhoz.
 *
 * Metszet erő = geo-matematikai konfidencia × halmaz prioritás × polgár trust score
 */

import type { Settlement, Halmaz, Metszet, Citizen } from './types';
import { geoLayerRegistry } from './ezoGeoLayer';

// ── Geo segédfüggvények ───────────────────────────────────────────────────────

/** Két pont közötti irányszög (0–360°) */
function bearingDeg(
  fromLat: number, fromLng: number,
  toLat: number,   toLng: number
): number {
  const dLng = (toLng - fromLng) * (Math.PI / 180);
  const lat1 = fromLat * (Math.PI / 180);
  const lat2 = toLat   * (Math.PI / 180);
  const y    = Math.sin(dLng) * Math.cos(lat2);
  const x    = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/** Haversine távolság métere */
function distanceM(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── SettlementEngine ──────────────────────────────────────────────────────────

export class SettlementEngine {
  private settlements = new Map<string, Settlement>();

  add(s: Settlement) {
    this.settlements.set(s.id, s);
  }

  get(id: string): Settlement | undefined {
    return this.settlements.get(id);
  }

  all(): Settlement[] {
    return [...this.settlements.values()];
  }

  addHalmaz(settlementId: string, h: Halmaz) {
    const s = this.settlements.get(settlementId);
    if (!s) throw new Error(`Ismeretlen település: ${settlementId}`);
    h.settlementId = settlementId;
    s.halmazok.push(h);
  }

  /**
   * Polgár metszeteinek kiszámítása az összes halmazhoz.
   *
   * Algoritmus:
   * 1. Polgár geo-rétegét lekérdezzük
   * 2. Minden halmazhoz kiszámítjuk az irányszöget a polgár lakóhelyéhez képest
   * 3. A geo-réteg ezen szögnél adja a konfidenciát
   * 4. Metszet erő = konfidencia × halmaz prioritás
   */
  computeMetszetekForCitizen(
    citizen: Citizen,
    citizenLocation?: [number, number]
  ): Metszet[] {
    const layer = geoLayerRegistry.get(citizen.id);
    if (!layer) return [];

    const settlement = this.settlements.get(citizen.settlementId);
    if (!settlement) return [];

    // Polgár helyzete: lakóhely középpontja ha nem pontosabb
    const [cLat, cLng] = citizenLocation ?? settlement.center;

    const metszetek: Metszet[] = [];

    for (const halmaz of settlement.halmazok) {
      const dist = distanceM(cLat, cLng, halmaz.center[0], halmaz.center[1]);

      // Csak azon halmazokat vesszük figyelembe, amelyekben jelen lehet
      // (radius + 2km tágítás a „közel halmaz" zónáért)
      if (dist > halmaz.radius * 1.5 + 2000) continue;

      const angle   = bearingDeg(cLat, cLng, halmaz.center[0], halmaz.center[1]);
      const overlap = layer.computeIntersection(angle, halmaz.priority);

      // Közelség szorzó: ha benne van a halmazban, 1.0; ha csak közel, csökkentett
      const proximityFactor = dist < halmaz.radius ? 1.0 : 1.0 - (dist - halmaz.radius) / 2000;

      const strength = Math.max(0, overlap.strength * Math.max(0, proximityFactor));

      if (strength < 0.01) continue;  // nem releváns metszet

      metszetek.push({
        id:          `M-${citizen.id}-${halmaz.id}`,
        citizenId:   citizen.id,
        halmazId:    halmaz.id,
        settlementId: halmaz.settlementId,
        strength:    +strength.toFixed(4),
        confidence:  overlap.confidence,
        dir:         overlap.dir,
        assets:      [],    // kitölti az assetRegistry
        computedAt:  Date.now(),
      });
    }

    return metszetek.sort((a, b) => b.strength - a.strength);
  }

  /**
   * Összes polgár metszete egy halmazhoz (prioritás-rendező nézet).
   * Eredmény: { halmazId, citizens: [{citizenId, strength}] }
   */
  computeHalmazPopulation(
    halmazId: string,
    citizens: Citizen[]
  ): Array<{ citizenId: string; name: string; strength: number }> {
    const result: Array<{ citizenId: string; name: string; strength: number }> = [];

    for (const citizen of citizens) {
      const layer = geoLayerRegistry.get(citizen.id);
      if (!layer) continue;

      const settlement = this.settlements.get(citizen.settlementId);
      if (!settlement) continue;

      const halmaz = settlement.halmazok.find(h => h.id === halmazId);
      if (!halmaz) continue;

      const angle    = bearingDeg(...settlement.center, ...halmaz.center);
      const overlap  = layer.computeIntersection(angle, halmaz.priority);

      result.push({
        citizenId: citizen.id,
        name:      citizen.name,
        strength:  overlap.strength,
      });
    }

    return result.sort((a, b) => b.strength - a.strength);
  }
}

export const settlementEngine = new SettlementEngine();

// ── Alap Magyarország dataset (bővíthető) ─────────────────────────────────────

export function seedHungaryData() {
  const settlements: Settlement[] = [
    {
      id: 'bp',
      name: 'Budapest',
      center: [47.4979, 19.0402],
      halmazok: [
        {
          id: 'bp-A', settlementId: 'bp', name: 'Belváros – Kiemelt Értékzóna',
          type: 'ertekzona', priority: 0.95,
          center: [47.4979, 19.0502], radius: 3500,
          color: '#4f46e5',
          bounds: [[47.51,19.03],[47.52,19.08],[47.48,19.09],[47.47,19.04]],
        },
        {
          id: 'bp-B', settlementId: 'bp', name: 'Duna-part – Tranzakciós Zóna',
          type: 'tranzakcios', priority: 0.80,
          center: [47.5019, 19.0602], radius: 2500,
          color: '#10b981',
          bounds: [[47.51,19.05],[47.52,19.07],[47.49,19.08],[47.48,19.06]],
        },
        {
          id: 'bp-C', settlementId: 'bp', name: 'XI. kerület – Szabályozási Zóna',
          type: 'szabalyozas', priority: 0.65,
          center: [47.4750, 19.0280], radius: 4000,
          color: '#f59e0b',
          bounds: [[47.49,19.00],[47.50,19.05],[47.46,19.06],[47.45,19.01]],
        },
      ],
    },
    {
      id: 'db',
      name: 'Debrecen',
      center: [47.5316, 21.6273],
      halmazok: [
        {
          id: 'db-A', settlementId: 'db', name: 'Belváros – Kiemelt Zóna',
          type: 'ertekzona', priority: 0.88,
          center: [47.5316, 21.6373], radius: 3000,
          color: '#4f46e5',
          bounds: [[47.54,21.62],[47.55,21.66],[47.52,21.65],[47.51,21.61]],
        },
        {
          id: 'db-B', settlementId: 'db', name: 'Ipari Zóna',
          type: 'infrastruktura', priority: 0.70,
          center: [47.5200, 21.6500], radius: 2500,
          color: '#6366f1',
          bounds: [[47.53,21.63],[47.53,21.67],[47.51,21.67],[47.51,21.63]],
        },
      ],
    },
    {
      id: 'pe',
      name: 'Pécs',
      center: [46.0727, 18.2320],
      halmazok: [
        {
          id: 'pe-A', settlementId: 'pe', name: 'Belváros',
          type: 'kulturalis', priority: 0.92,
          center: [46.0727, 18.2420], radius: 2800,
          color: '#a855f7',
          bounds: [[46.08,18.22],[46.09,18.26],[46.06,18.26],[46.06,18.22]],
        },
      ],
    },
  ];

  for (const s of settlements) {
    const halmazok = s.halmazok;
    s.halmazok = [];
    settlementEngine.add(s);
    for (const h of halmazok) {
      settlementEngine.addHalmaz(s.id, h);
    }
  }
}
