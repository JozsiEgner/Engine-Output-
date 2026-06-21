/**
 * Ézó Emberközpontú Prioritás Kezelő
 *
 * A metszetek alapján prioritásokat számít minden polgárhoz.
 * Az iránya (É/K/D/Ny) meghatározza a prioritás típusát:
 *
 *   É (north/kék):  Elemzés, kérdés, teher-vizsgálat
 *   K (east/zöld):  Cselekvés, tranzakció indítása
 *   D (south/vörös): Döntés, jóváhagyás, lezárás [DÖNTŐ]
 *   Ny (west/ibolya): Tanulás, előzmény, dokumentáció
 */

import type { Priority, PriorityDir, Metszet, Citizen } from './types';

// Irány → prioritás típus és leírás sablon
const DIR_META: Record<PriorityDir, { type: string; label: string; color: string; description: (m: Metszet) => string }> = {
  north: {
    type:  'elemzes',
    label: 'Elemzés & Teher-vizsgálat',
    color: '#00d4ff',
    description: m => `${m.halmazId} zónában teher/forgalom elemzés szükséges. Geo-konfidencia: ${(m.confidence * 100).toFixed(0)}%.`,
  },
  east: {
    type:  'tranzakcio',
    label: 'Tranzakció Indítható',
    color: '#00ff88',
    description: m => `Aktív cselekvési lehetőség ${m.halmazId} zónában. Metszet erő: ${(m.strength * 100).toFixed(0)}%.`,
  },
  south: {
    type:  'dontes',
    label: 'Döntő Jóváhagyás',
    color: '#ff4488',
    description: m => `Döntő szintű metszet ${m.halmazId} zónával. Kötelező jóváhagyás! Erő: ${(m.strength * 100).toFixed(0)}%.`,
  },
  west: {
    type:  'dokumentacio',
    label: 'Dokumentáció & Előzmény',
    color: '#aa44ff',
    description: m => `Meglévő előzmény és dokumentáció szükséges a ${m.halmazId} zónához.`,
  },
};

// ── PriorityEngine ────────────────────────────────────────────────────────────

export class PriorityEngine {
  private priorities = new Map<string, Priority[]>();

  /**
   * Polgár metszeteinek konvertálása prioritásokká.
   * Minden releváns metszet → egy prioritás.
   * Azonos irányból érkező metszetek összegzik súlyaikat.
   */
  compute(citizen: Citizen, metszetek: Metszet[]): Priority[] {
    // Irányonként csoportosítás
    const byDir = new Map<PriorityDir, Metszet[]>();
    for (const m of metszetek) {
      const list = byDir.get(m.dir) ?? [];
      list.push(m);
      byDir.set(m.dir, list);
    }

    const priorities: Priority[] = [];

    for (const [dir, mList] of byDir) {
      const meta       = DIR_META[dir];
      const topMetszet = mList[0];  // legerősebb metszet ebben az irányban
      const totalWeight = mList.reduce((sum, m) => sum + m.strength, 0) / mList.length;

      priorities.push({
        id:              `P-${citizen.id}-${dir}-${Date.now()}`,
        citizenId:       citizen.id,
        label:           meta.label,
        description:     meta.description(topMetszet),
        weight:          +Math.min(1, totalWeight).toFixed(4),
        dir,
        type:            meta.type,
        active:          totalWeight > 0.1,
        relatedAssets:   mList.flatMap(m => m.assets),
        relatedHalmazok: mList.map(m => m.halmazId),
        createdAt:       Date.now(),
      });
    }

    // Súly szerint rendezve (legfontosabb elöl)
    priorities.sort((a, b) => b.weight - a.weight);

    this.priorities.set(citizen.id, priorities);
    return priorities;
  }

  /** Összes aktív prioritás egy kör-prioritás kezelőhöz */
  allActive(): Priority[] {
    const all: Priority[] = [];
    for (const list of this.priorities.values()) {
      all.push(...list.filter(p => p.active));
    }
    return all.sort((a, b) => b.weight - a.weight);
  }

  /** Egy polgár prioritásai */
  forCitizen(citizenId: string): Priority[] {
    return this.priorities.get(citizenId) ?? [];
  }

  /** Rendszer-szintű prioritás-összesítő (emberközpontú nézet) */
  systemSummary(): {
    totalActive: number;
    byDir: Record<PriorityDir, number>;
    topPriorities: Priority[];
  } {
    const active = this.allActive();
    const byDir: Record<PriorityDir, number> = { north: 0, east: 0, south: 0, west: 0 };
    for (const p of active) byDir[p.dir]++;

    return {
      totalActive:    active.length,
      byDir,
      topPriorities:  active.slice(0, 10),
    };
  }

  clear(citizenId?: string) {
    if (citizenId) {
      this.priorities.delete(citizenId);
    } else {
      this.priorities.clear();
    }
  }
}

export const priorityEngine = new PriorityEngine();

// Irány metaadatok exportálása (UI-hoz)
export const DIR_UI_META = DIR_META;
