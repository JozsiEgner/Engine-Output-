/**
 * Ézó Registry – Bővíthető, Megosztható Nyilvántartás
 *
 * NESABLONOS: Semmi sincs hardkódolva.
 * Minden adat a registryn keresztül folyik.
 * Export/import: JSON formátumban teljesen hordozható.
 */

import type {
  Citizen, Asset, Settlement, EzoPlugin, RegistryExport, KapocsEvent, KapocsEventHandler,
} from './types';
import { geoLayerRegistry } from './ezoGeoLayer';
import { settlementEngine }  from './ezoSettlement';

// ── EventBus ──────────────────────────────────────────────────────────────────

class EventBus {
  private listeners = new Map<string, Set<KapocsEventHandler>>();

  on(type: string, handler: KapocsEventHandler) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(handler);
    this.listeners.set(type, set);
    return () => set.delete(handler);   // unsubscribe függvény
  }

  emit(event: KapocsEvent) {
    this.listeners.get(event.type)?.forEach(h => h(event as never));
    this.listeners.get('*')?.forEach(h => h(event as never));
  }
}

// ── EzoRegistry ───────────────────────────────────────────────────────────────

export class EzoRegistry {
  private citizens   = new Map<string, Citizen>();
  private assets     = new Map<string, Asset>();
  private plugins    = new Map<string, EzoPlugin>();
  readonly events    = new EventBus();
  readonly version   = '1.0.0';

  // ── Állampolgár kezelés ────────────────────────────────────────────────────

  addCitizen(c: Citizen): Citizen {
    this.citizens.set(c.id, c);
    // Automatikus geo-réteg létrehozás
    geoLayerRegistry.getOrCreate(c);
    this.events.emit({ type: 'citizen:add', payload: c });
    // Plugin hook
    for (const p of this.plugins.values()) p.hooks?.onCitizenAdd?.(c);
    return c;
  }

  updateCitizen(id: string, patch: Partial<Citizen>): Citizen | undefined {
    const existing = this.citizens.get(id);
    if (!existing) return;
    const updated = { ...existing, ...patch };
    this.citizens.set(id, updated);
    this.events.emit({ type: 'citizen:update', payload: updated });
    return updated;
  }

  getCitizen(id: string): Citizen | undefined { return this.citizens.get(id); }
  allCitizens(): Citizen[] { return [...this.citizens.values()]; }
  citizensBySettlement(sId: string): Citizen[] { return this.allCitizens().filter(c => c.settlementId === sId); }

  // ── Vagyontárgy kezelés ───────────────────────────────────────────────────

  addAsset(a: Asset): Asset {
    this.assets.set(a.id, a);
    this.events.emit({ type: 'asset:add', payload: a });
    for (const p of this.plugins.values()) p.hooks?.onAssetAdd?.(a);
    return a;
  }

  getAsset(id: string): Asset | undefined { return this.assets.get(id); }
  allAssets(): Asset[] { return [...this.assets.values()]; }
  assetsForCitizen(citizenId: string): Asset[] { return this.allAssets().filter(a => a.ownerId === citizenId); }
  assetsForSettlement(sId: string): Asset[] { return this.allAssets().filter(a => a.settlementId === sId); }

  // ── Plugin rendszer ───────────────────────────────────────────────────────

  registerPlugin(p: EzoPlugin) {
    this.plugins.set(p.id, p);
    p.init(this.export());
    this.events.emit({ type: 'plugin:registered', payload: p });
  }

  // ── Export / Import (megoszthatóság) ─────────────────────────────────────

  export(): RegistryExport {
    return {
      version:    this.version,
      exportedAt: Date.now(),
      citizens:   this.allCitizens(),
      assets:     this.allAssets(),
      settlements: settlementEngine.all(),
      plugins:    [...this.plugins.keys()],
    };
  }

  import(data: RegistryExport) {
    for (const s of data.settlements) {
      const halmazok = s.halmazok;
      s.halmazok = [];
      settlementEngine.add(s);
      for (const h of halmazok) settlementEngine.addHalmaz(s.id, h);
    }
    for (const c of data.citizens) this.addCitizen(c);
    for (const a of data.assets)   this.addAsset(a);
  }

  /** Statisztikák */
  stats() {
    return {
      citizens:    this.citizens.size,
      assets:      this.assets.size,
      settlements: settlementEngine.all().length,
      plugins:     this.plugins.size,
      geoLayers:   geoLayerRegistry.size(),
    };
  }
}

export const ezoRegistry = new EzoRegistry();

// ── Demo adat betöltő (bővíthető sablon) ─────────────────────────────────────

export function loadDemoData() {
  const citizens: Citizen[] = [
    {
      id: 'c-anna', name: 'Szabó Anna', settlementId: 'bp',
      trustLevel: 'ellenorzott', trustScore: 0.97,
      kapocsTokemId: 'EK-A1029-XMZR',
      metadata: { occupation: 'ügyvéd', verified: true },
    },
    {
      id: 'c-peter', name: 'Kovács Péter', settlementId: 'bp',
      trustLevel: 'magas', trustScore: 0.88,
      kapocsTokemId: 'EK-P3847-QWVT',
      metadata: { occupation: 'vállalkozó' },
    },
    {
      id: 'c-eszter', name: 'Nagy Eszter', settlementId: 'db',
      trustLevel: 'magas', trustScore: 0.85,
      kapocsTokemId: 'EK-E2193-LKPD',
      metadata: {},
    },
    {
      id: 'c-istvan', name: 'Tóth István', settlementId: 'pe',
      trustLevel: 'kozepes', trustScore: 0.72,
      kapocsTokemId: 'EK-I5502-BNRW',
      metadata: {},
    },
  ];

  const assets: Asset[] = [
    {
      id: 'a-01', type: 'ingatlan', name: 'Lakás Budapesten – II. ker.',
      ownerId: 'c-anna', settlementId: 'bp', value: 45000000,
      status: 'ellenorzott', location: [47.510, 19.035],
      halmaz: ['bp-A'], metadata: { rooms: 3, m2: 78 },
    },
    {
      id: 'a-02', type: 'jarmu', name: 'Volvo XC60 – 2022',
      ownerId: 'c-anna', settlementId: 'bp', value: 12000000,
      status: 'ellenorzott', metadata: { vin: 'YV1XC602XN1234567' },
    },
    {
      id: 'a-03', type: 'ingatlan', name: 'Iroda – XIII. ker.',
      ownerId: 'c-peter', settlementId: 'bp', value: 28000000,
      status: 'atruhazhato', location: [47.515, 19.060],
      halmaz: ['bp-B'], metadata: { m2: 45 },
    },
    {
      id: 'a-04', type: 'nemesfem', name: 'Aranyrúd – 100g',
      ownerId: 'c-peter', settlementId: 'bp', value: 2800000,
      status: 'ellenorzott', metadata: { purity: '999.9' },
    },
    {
      id: 'a-05', type: 'ingatlan', name: 'Ház Debrecenben',
      ownerId: 'c-eszter', settlementId: 'db', value: 32000000,
      status: 'fuggo', location: [47.533, 21.638],
      halmaz: ['db-A'], metadata: { m2: 120 },
    },
    {
      id: 'a-06', type: 'mutargy', name: 'Csontváry reprodukció – hitelesített',
      ownerId: 'c-istvan', settlementId: 'pe', value: 800000,
      status: 'ellenorzott', metadata: { cert: 'MKKI-2024-0042' },
    },
  ];

  for (const c of citizens) ezoRegistry.addCitizen(c);
  for (const a of assets)   ezoRegistry.addAsset(a);
}
