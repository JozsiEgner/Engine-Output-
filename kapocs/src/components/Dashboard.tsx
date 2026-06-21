/**
 * Dashboard – Dinamikus, registry-alapú. Semmi nincs hardkódolva.
 */

import { useState, useEffect } from 'react';
import { ShieldCheck, Activity, Users, FileSignature } from 'lucide-react';
import { motion } from 'motion/react';
import { EzoVisualizer }  from './EzoVisualizer';
import { kapocsEngine }   from '../lib/ezoKapocs';
import type { Citizen, Asset } from '../lib/types';
import { formatHUF } from '../lib/utils';

const ASSET_STATUS_LABEL: Record<string, string> = {
  ellenorzott:  'Ellenőrzött',
  fuggo:        'Függő',
  vitarendeles: 'Vitarendezés',
  atruhazhato:  'Átruházható',
};

const STATUS_COLOR: Record<string, string> = {
  ellenorzott:  'text-emerald-600 bg-emerald-50',
  fuggo:        'text-amber-600 bg-amber-50',
  vitarendeles: 'text-red-600 bg-red-50',
  atruhazhato:  'text-blue-600 bg-blue-50',
};

export function Dashboard() {
  const [citizen,  setCitizen]  = useState<Citizen | null>(null);
  const [assets,   setAssets]   = useState<Asset[]>([]);
  const [overview, setOverview] = useState<ReturnType<typeof kapocsEngine.systemOverview> | null>(null);

  useEffect(() => {
    kapocsEngine.init();
    const citizens = kapocsEngine.registry.allCitizens();
    const first    = citizens[0] ?? null;
    setCitizen(first);

    if (first) setAssets(kapocsEngine.registry.assetsForCitizen(first.id));
    setOverview(kapocsEngine.systemOverview());
  }, []);

  if (!citizen || !overview) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Rendszer inicializálás...</div>;
  }

  const verified  = assets.filter(a => a.status === 'ellenorzott').length;
  const pending   = assets.filter(a => a.status === 'fuggo').length;
  const totalVal  = assets.reduce((s, a) => s + (a.value ?? 0), 0);

  const stats = [
    { label: 'Vagyontárgyak',     value: String(assets.length),   icon: Activity,       color: 'text-blue-500',   bg: 'bg-blue-50'   },
    { label: 'Hitelesített',      value: String(verified),         icon: ShieldCheck,    color: 'text-emerald-500', bg: 'bg-emerald-50' },
    { label: 'Polgártársak',      value: String(overview.registry.citizens), icon: Users, color: 'text-purple-500', bg: 'bg-purple-50' },
    { label: 'Függő tranzakció',  value: String(pending),          icon: FileSignature, color: 'text-amber-500',  bg: 'bg-amber-50'  },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Üdvözöljük, {citizen.name}!</h2>
          <p className="text-xs text-slate-500 mt-1">
            Token: <span className="font-mono text-slate-700">{citizen.kapocsTokemId}</span>
            {' '}• Trust: <span className="font-bold text-emerald-600">{citizen.trustLevel}</span>
            {' '}• Érték: <span className="font-bold text-slate-700">{formatHUF(totalVal)}</span>
          </p>
        </div>
        <span className="hidden sm:flex px-3 py-1 bg-white border border-slate-200 rounded-full text-[10px] font-bold text-slate-500 uppercase">
          ÉZÓ-CORE aktív
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, idx) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xl font-bold text-slate-800">{stat.value}</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">{stat.label}</div>
              </div>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stat.bg} ${stat.color}`}>
                <stat.icon className="w-5 h-5" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Vagyontárgy lista */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Vagyontárgyak</h3>
          <div className="space-y-3">
            {assets.map(a => (
              <div key={a.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg transition-all">
                <div className="w-8 h-8 rounded-md flex items-center justify-center bg-slate-100 text-slate-600 text-[9px] font-bold uppercase">
                  {a.type.slice(0, 3)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-800 truncate">{a.name}</p>
                  <p className="text-[9px] text-slate-400">{a.value ? formatHUF(a.value) : '—'}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${STATUS_COLOR[a.status] ?? 'text-slate-600 bg-slate-50'}`}>
                  {ASSET_STATUS_LABEL[a.status] ?? a.status}
                </span>
              </div>
            ))}
          </div>

          {/* Rendszer összesítő */}
          <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-3 gap-2">
            {overview.settlements.map(s => (
              <div key={s.id} className="text-center">
                <p className="text-xs font-bold text-slate-700">{s.name}</p>
                <p className="text-[9px] text-slate-400">{s.citizenCount} polgár</p>
                <p className="text-[9px] text-slate-400">{s.assetCount} vagyon</p>
              </div>
            ))}
          </div>
        </div>

        {/* Geo vizualizátor */}
        <EzoVisualizer citizen={citizen} />
      </div>
    </div>
  );
}
