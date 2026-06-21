/**
 * Ézó Kapocs – Bővíthető típusszerződés
 *
 * Minden modul ezt az interfészt implementálja.
 * Az összes típus exportált → bárki importálhatja és kiterjesztheti.
 */

// ── Geo-matematikai réteg ─────────────────────────────────────────────────────

export interface GeoLayerSnapshot {
  step: number;
  reticleAngle: number;
  tension: number;
  resonance: number;
  avgConfidence: number;
  northWeight: number;
  eastWeight: number;
  southWeight: number;
  westWeight: number;
}

// ── Állampolgár / Személy ──────────────────────────────────────────────────────

export type TrustLevel = 'alacsony' | 'kozepes' | 'magas' | 'ellenorzott';

export interface Citizen {
  id: string;                    // egyedi azonosító
  name: string;
  settlementId: string;          // lakóhely
  trustLevel: TrustLevel;
  trustScore: number;            // 0–1
  kapocsTokemId: string;         // EK-{id}
  geoLayer?: GeoLayerSnapshot;   // frissített geo-réteg
  metadata: Record<string, unknown>;  // bővíthető!
}

// ── Vagyontárgy ───────────────────────────────────────────────────────────────

export type AssetType =
  | 'ingatlan'
  | 'jarmu'
  | 'ingosag'
  | 'nemesfem'
  | 'mutargy'
  | 'ceges'
  | 'mezogazdasagi'
  | 'orokseg'
  | string;   // bővíthető: saját típusok

export type AssetStatus = 'fuggo' | 'ellenorzott' | 'vitarendeles' | 'atruhazhato';

export interface Asset {
  id: string;
  type: AssetType;
  name: string;
  ownerId: string;
  settlementId: string;
  value?: number;
  currency?: string;
  status: AssetStatus;
  location?: [number, number];   // lat, lng
  halmaz?: string[];             // melyik halmazokban szerepel
  metadata: Record<string, unknown>;
}

// ── Település / Settlement ─────────────────────────────────────────────────────

export interface Settlement {
  id: string;
  name: string;
  center: [number, number];      // lat, lng
  halmazok: Halmaz[];
}

export type HalmazType =
  | 'ertekzona'
  | 'tranzakcios'
  | 'szabalyozas'
  | 'kulturalis'
  | 'infrastruktura'
  | string;

export interface Halmaz {
  id: string;
  settlementId: string;
  name: string;
  type: HalmazType;
  bounds: [number, number][];    // polygon pontok
  center: [number, number];
  radius: number;                // méter
  priority: number;              // 0–1
  color?: string;
}

// ── Metszet (Intersection) ────────────────────────────────────────────────────

export interface Metszet {
  id: string;
  citizenId: string;
  halmazId: string;
  settlementId: string;
  strength: number;              // 0–1 geo-matematikai erő
  confidence: number;            // 0–1 tengely megbízhatóság
  dir: 'north' | 'east' | 'south' | 'west';
  assets: string[];              // érintett vagyontárgyak
  computedAt: number;            // timestamp
}

// ── Prioritás ─────────────────────────────────────────────────────────────────

export type PriorityDir = 'north' | 'east' | 'south' | 'west';

export interface Priority {
  id: string;
  citizenId: string;
  label: string;
  description: string;
  weight: number;                // 0–1 (geo-réteg alapján)
  dir: PriorityDir;
  type: string;
  active: boolean;
  relatedAssets: string[];
  relatedHalmazok: string[];
  createdAt: number;
}

// ── Plugin rendszer ───────────────────────────────────────────────────────────

export interface EzoPlugin {
  id: string;
  name: string;
  version: string;
  init(registry: RegistryExport): void;
  process?(data: unknown): unknown;
  hooks?: {
    onCitizenAdd?(citizen: Citizen): void;
    onAssetAdd?(asset: Asset): void;
    onMetszetCompute?(metszet: Metszet): void;
  };
}

// ── Registry export (bővíthető, megosztható) ──────────────────────────────────

export interface RegistryExport {
  version: string;
  exportedAt: number;
  citizens: Citizen[];
  assets: Asset[];
  settlements: Settlement[];
  plugins: string[];             // plugin ID-k
}

// ── Esemény bus ───────────────────────────────────────────────────────────────

export type KapocsEvent =
  | { type: 'citizen:add'; payload: Citizen }
  | { type: 'citizen:update'; payload: Citizen }
  | { type: 'asset:add'; payload: Asset }
  | { type: 'metszet:computed'; payload: Metszet[] }
  | { type: 'priority:updated'; payload: Priority[] }
  | { type: 'plugin:registered'; payload: EzoPlugin };

export type KapocsEventHandler<T extends KapocsEvent = KapocsEvent> = (event: T) => void;
