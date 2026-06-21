/**
 * Ézó KapocsEngine – Fő Orchestrátor
 *
 * Összefogja a registry-t, geo-rétegeket, metszet-számítást és prioritásokat.
 * Singleton: az egész alkalmazás ezen keresztül kommunikál.
 *
 * Használat:
 *   import { kapocsEngine } from './ezoKapocs';
 *   kapocsEngine.init();
 *   const result = kapocsEngine.processCitizen('c-anna');
 */

import { ezoRegistry, loadDemoData }              from './ezoRegistry';
import { geoLayerRegistry }                        from './ezoGeoLayer';
import { settlementEngine, seedHungaryData }        from './ezoSettlement';
import { priorityEngine }                          from './ezoPriority';
import type { Citizen, Metszet, Priority, Asset }  from './types';

export interface CitizenProcessResult {
  citizen:    Citizen;
  geoSnapshot: ReturnType<typeof geoLayerRegistry.get> extends infer T
    ? T extends object ? ReturnType<NonNullable<T>['snapshot']> : never
    : never;
  metszetek:  Metszet[];
  priorities: Priority[];
  assets:     Asset[];
}

class KapocsEngine {
  private _initialized = false;
  private _step = 0;

  /** Inicializálás – egyszer hívandó */
  init(loadDemo = true) {
    if (this._initialized) return this;
    seedHungaryData();
    if (loadDemo) loadDemoData();
    this._initialized = true;
    return this;
  }

  get initialized() { return this._initialized; }
  get step()        { return this._step; }

  /**
   * Egy polgár teljes feldolgozása:
   * geo-tick → metszet-számítás → prioritás-számítás
   */
  processCitizen(citizenId: string): CitizenProcessResult | null {
    const citizen = ezoRegistry.getCitizen(citizenId);
    if (!citizen) return null;

    const layer = geoLayerRegistry.get(citizenId);
    if (!layer) return null;

    layer.tick();
    const geoSnapshot = layer.snapshot();

    // Geo-snapshot frissítés a citizen rekordban
    ezoRegistry.updateCitizen(citizenId, { geoLayer: geoSnapshot });

    // Metszetek számítása
    const metszetek = settlementEngine.computeMetszetekForCitizen(citizen);

    // Asset hozzárendelés a metszetek assets mezőjéhez
    const citizenAssets = ezoRegistry.assetsForCitizen(citizenId);
    for (const m of metszetek) {
      m.assets = citizenAssets
        .filter(a => a.halmaz?.includes(m.halmazId))
        .map(a => a.id);
    }

    // Prioritások számítása
    const priorities = priorityEngine.compute(citizen, metszetek);

    ezoRegistry.events.emit({ type: 'metszet:computed', payload: metszetek });
    ezoRegistry.events.emit({ type: 'priority:updated', payload: priorities });

    return { citizen, geoSnapshot, metszetek, priorities, assets: citizenAssets };
  }

  /** Az összes polgár feldolgozása – rendszer tick */
  tickAll() {
    this._step++;
    const results: Record<string, CitizenProcessResult | null> = {};
    for (const c of ezoRegistry.allCitizens()) {
      results[c.id] = this.processCitizen(c.id);
    }
    return results;
  }

  /** Rendszer-szintű áttekintés */
  systemOverview() {
    return {
      step:           this._step,
      registry:       ezoRegistry.stats(),
      prioritySummary: priorityEngine.systemSummary(),
      settlements:    settlementEngine.all().map(s => ({
        id:   s.id,
        name: s.name,
        halmazCount:   s.halmazok.length,
        citizenCount:  ezoRegistry.citizensBySettlement(s.id).length,
        assetCount:    ezoRegistry.assetsForSettlement(s.id).length,
      })),
    };
  }

  // Proxy-k a közös hozzáféréshez
  get registry()   { return ezoRegistry; }
  get settlements(){ return settlementEngine; }
  get priorities() { return priorityEngine; }
  get geoLayers()  { return geoLayerRegistry; }
}

export const kapocsEngine = new KapocsEngine();
