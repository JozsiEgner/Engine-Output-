/**
 * Vagyontárgy-kezelő – Dinamikus, registry-alapú.
 * Bővíthető: új asset típusokat bárki hozzáadhat.
 */

import { useState, useEffect } from 'react';
import { kapocsEngine }  from '../lib/ezoKapocs';
import type { Asset, Citizen } from '../lib/types';
import { formatHUF } from '../lib/utils';

const TYPE_ICON: Record<string, string> = {
  ingatlan:      '🏠',
  jarmu:         '🚗',
  ingosag:       '📦',
  nemesfem:      '🥇',
  mutargy:       '🖼',
  ceges:         '🏢',
  mezogazdasagi: '🌾',
  orokseg:       '📜',
};

const STATUS_STYLE: Record<string, string> = {
  ellenorzott:  'text-emerald-700 bg-emerald-50 border-emerald-200',
  fuggo:        'text-amber-700   bg-amber-50   border-amber-200',
  vitarendeles: 'text-red-700     bg-red-50     border-red-200',
  atruhazhato:  'text-blue-700    bg-blue-50    border-blue-200',
};

const STATUS_HU: Record<string, string> = {
  ellenorzott:  'Ellenőrzött',
  fuggo:        'Függő',
  vitarendeles: 'Vitarendezés',
  atruhazhato:  'Átruházható',
};

function AssetCard({ asset, owner }: { asset: Asset; owner?: Citizen }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-xl">
            {TYPE_ICON[asset.type] ?? '📁'}
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800 leading-tight">{asset.name}</p>
            <p className="text-[10px] text-slate-400 mt-0.5 uppercase font-bold">{asset.type}</p>
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${STATUS_STYLE[asset.status] ?? 'text-slate-600 bg-slate-50 border-slate-200'}`}>
          {STATUS_HU[asset.status] ?? asset.status}
        </span>
      </div>

      <div className="space-y-1.5 text-[10px]">
        {asset.value && (
          <div className="flex justify-between">
            <span className="text-slate-400">Becsült érték</span>
            <span className="font-bold text-slate-700">{formatHUF(asset.value)}</span>
          </div>
        )}
        {owner && (
          <div className="flex justify-between">
            <span className="text-slate-400">Tulajdonos</span>
            <span className="font-bold text-slate-700">{owner.name}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-slate-400">Token</span>
          <span className="font-mono text-slate-600 text-[9px]">{owner?.kapocsTokemId ?? '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Azonosító</span>
          <span className="font-mono text-slate-600 text-[9px]">{asset.id}</span>
        </div>
        {asset.halmaz && asset.halmaz.length > 0 && (
          <div className="flex gap-1 flex-wrap pt-1">
            {asset.halmaz.map(h => (
              <span key={h} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded text-[8px] font-bold">{h}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Assets() {
  const [assets,    setAssets]    = useState<Asset[]>([]);
  const [citizens,  setCitizens]  = useState<Citizen[]>([]);
  const [filter,    setFilter]    = useState<string>('all');
  const [typeFilter,setTypeFilter]= useState<string>('all');

  useEffect(() => {
    kapocsEngine.init();
    setAssets(kapocsEngine.registry.allAssets());
    setCitizens(kapocsEngine.registry.allCitizens());
  }, []);

  const types   = ['all', ...new Set(assets.map(a => a.type))];
  const owners  = ['all', ...citizens.map(c => c.id)];

  const filtered = assets.filter(a => {
    const ownerOk = filter === 'all'    || a.ownerId === filter;
    const typeOk  = typeFilter === 'all' || a.type   === typeFilter;
    return ownerOk && typeOk;
  });

  const totalVal = filtered.reduce((s, a) => s + (a.value ?? 0), 0);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">ÉrtékKapocs Vagyontárgyak</h2>
          <p className="text-xs text-slate-500 mt-1">
            {filtered.length} elem · Összérték: <strong>{formatHUF(totalVal)}</strong>
          </p>
        </div>
      </div>

      {/* Szűrők */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap gap-4">
        <div className="flex gap-2 flex-wrap">
          <span className="text-[10px] font-bold text-slate-500 uppercase self-center">Tulajdonos:</span>
          {owners.map(id => {
            const c = citizens.find(x => x.id === id);
            return (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${filter === id ? 'bg-slate-800 text-white border-slate-800' : 'text-slate-600 border-slate-200 hover:border-slate-400'}`}
              >
                {id === 'all' ? 'Mindenki' : (c?.name ?? id)}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 flex-wrap border-t sm:border-t-0 sm:border-l border-slate-200 sm:pl-4 pt-2 sm:pt-0">
          <span className="text-[10px] font-bold text-slate-500 uppercase self-center">Típus:</span>
          {types.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${typeFilter === t ? 'bg-slate-800 text-white border-slate-800' : 'text-slate-600 border-slate-200 hover:border-slate-400'}`}
            >
              {t === 'all' ? 'Mind' : t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(a => (
          <AssetCard key={a.id} asset={a} owner={citizens.find(c => c.id === a.ownerId)} />
        ))}
      </div>
    </div>
  );
}
