/**
 * Ézó Személyes Geo-Réteg
 *
 * Minden állampolgárnak EGYEDI geo-matematikai rétege van,
 * amelyet az azonosítójából (ID) derivált seed határoz meg.
 *
 * Ez a "digitális ujjlenyomat" – reprodukálható, de személyre szabott.
 */

import { EzoCore, weylAngle, seedFromId } from './ezoCore';
import type { Citizen, GeoLayerSnapshot, TrustLevel } from './types';

// TrustLevel → tension leképzés
const TRUST_TENSION: Record<TrustLevel, number> = {
  alacsony:     0.72,
  kozepes:      0.85,
  magas:        0.93,
  ellenorzott:  0.99,
};

// Irányok fény hullámhossza (nm)
export const LAMBDA = {
  north: 450,  // kék – kérdés
  east:  530,  // zöld – cselekvés
  south: 680,  // vörös – döntés [DÖNTŐ]
  west:  405,  // ibolya – tanulás
};

// ── PersonalGeoLayer ──────────────────────────────────────────────────────────

export class PersonalGeoLayer {
  readonly citizenId: string;
  readonly core: EzoCore;
  private _trustScore: number;
  private _name: string;

  constructor(citizen: Citizen) {
    this.citizenId   = citizen.id;
    this._name       = citizen.name;
    this._trustScore = citizen.trustScore;

    const tension   = TRUST_TENSION[citizen.trustLevel] ?? 0.85;
    const resonance = this._resonanceFromId(citizen.id);

    this.core = new EzoCore(citizen.id, tension, resonance);

    // Kezdeti betöltés: ID string + token ID
    const encoder = new TextEncoder();
    this.core.loadBinary(encoder.encode(`${citizen.kapocsTokemId}|${citizen.name}|${citizen.settlementId}`));
  }

  private _resonanceFromId(id: string): number {
    const seed = seedFromId(id);
    return 0.3 + (seed % 1000) / 1000 * 0.7;   // 0.3–1.0 tartomány
  }

  /** Lépés: frissíti a személyes geo-réteget */
  tick() {
    return this.core.tick();
  }

  /** Snapshot – ez kerül a Citizen.geoLayer mezőjébe */
  snapshot(): GeoLayerSnapshot {
    return this.core.snapshot();
  }

  /**
   * Metszet-erő számítása egy halmazhoz.
   * A halmaz irányára eső balloon sugár adja a metszet erősségét.
   *
   * @param halmazAngleDeg – a halmaz iránya a polgártól (0–360°)
   * @param halmazPriority – a halmaz fontossága (0–1)
   */
  computeIntersection(halmazAngleDeg: number, halmazPriority: number): {
    strength: number;
    confidence: number;
    dir: 'north' | 'east' | 'south' | 'west';
  } {
    const { confidence } = this.core.readAt(halmazAngleDeg);
    const strength       = confidence * halmazPriority * this._trustScore;

    // Irány meghatározás: melyik szektorra esik a szög?
    const dir = angleToDir(halmazAngleDeg);

    return {
      strength:   +strength.toFixed(4),
      confidence: +confidence.toFixed(4),
      dir,
    };
  }

  get trustScore() { return this._trustScore; }
  get name()       { return this._name; }
}

// Szög → égtáj irány
export function angleToDir(deg: number): 'north' | 'east' | 'south' | 'west' {
  const norm = ((deg % 360) + 360) % 360;
  if (norm >= 315 || norm < 45)  return 'north';
  if (norm >= 45  && norm < 135) return 'east';
  if (norm >= 135 && norm < 225) return 'south';
  return 'west';
}

// ── GeoLayerRegistry ──────────────────────────────────────────────────────────

export class GeoLayerRegistry {
  private layers = new Map<string, PersonalGeoLayer>();

  add(citizen: Citizen): PersonalGeoLayer {
    const layer = new PersonalGeoLayer(citizen);
    this.layers.set(citizen.id, layer);
    return layer;
  }

  get(citizenId: string): PersonalGeoLayer | undefined {
    return this.layers.get(citizenId);
  }

  getOrCreate(citizen: Citizen): PersonalGeoLayer {
    return this.layers.get(citizen.id) ?? this.add(citizen);
  }

  remove(citizenId: string) {
    this.layers.delete(citizenId);
  }

  tickAll(): Record<string, GeoLayerSnapshot> {
    const result: Record<string, GeoLayerSnapshot> = {};
    for (const [id, layer] of this.layers) {
      layer.tick();
      result[id] = layer.snapshot();
    }
    return result;
  }

  size() { return this.layers.size; }
  ids()  { return [...this.layers.keys()]; }
}

export const geoLayerRegistry = new GeoLayerRegistry();
