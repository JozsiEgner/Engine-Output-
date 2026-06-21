/**
 * Emberközpontú Prioritás Kezelő
 *
 * Megjeleníti az összes polgár prioritásait geo-matematikai súlyozással.
 * Irányok: É(kék)=elemzés, K(zöld)=cselekvés, D(piros)=döntés, Ny(lila)=dokumentáció
 */

import { useState, useEffect } from 'react';
import { kapocsEngine }        from '../lib/ezoKapocs';
import type { Priority, Citizen } from '../lib/types';
import { pct } from '../lib/utils';

const DIR_STYLE = {
  north: { label: 'É',  color: '#00d4ff', bg: 'bg-cyan-950',   border: 'border-cyan-700', badge: 'Elemzés'     },
  east:  { label: 'K',  color: '#00ff88', bg: 'bg-emerald-950', border: 'border-emerald-700', badge: 'Cselekvés' },
  south: { label: 'D',  color: '#ff4488', bg: 'bg-rose-950',    border: 'border-rose-700',   badge: 'Döntő'     },
  west:  { label: 'Ny', color: '#aa44ff', bg: 'bg-purple-950',  border: 'border-purple-700', badge: 'Tanulás'   },
};

function PriorityCard({ p }: { p: Priority }) {
  const s = DIR_STYLE[p.dir];
  return (
    <div className={`rounded-xl border ${s.border} ${s.bg} p-3 space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-black" style={{ background: s.color + '22', color: s.color }}>
            {s.label}
          </div>
          <div>
            <p className="text-[10px] font-bold text-white leading-tight">{p.label}</p>
            <p className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: s.color }}>{s.badge}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-black" style={{ color: s.color }}>{pct(p.weight)}</p>
          <p className="text-[8px] text-slate-500">Geo-súly</p>
        </div>
      </div>

      <p className="text-[9px] text-slate-400 leading-relaxed">{p.description}</p>

      <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: pct(p.weight), background: s.color }} />
      </div>

      {p.relatedHalmazok.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {p.relatedHalmazok.map(h => (
            <span key={h} className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-slate-800 text-slate-400 border border-slate-700">{h}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function PriorityManager() {
  const [citizens,   setCitizens]   = useState<Citizen[]>([]);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [selected,   setSelected]   = useState<string>('all');
  const [summary,    setSummary]    = useState({ totalActive: 0, byDir: { north: 0, east: 0, south: 0, west: 0 } });
  const [tick,       setTick]       = useState(0);

  useEffect(() => {
    kapocsEngine.init();
    setCitizens(kapocsEngine.registry.allCitizens());
  }, []);

  useEffect(() => {
    // Egy full tick a rendszeren
    kapocsEngine.tickAll();
    const sm = kapocsEngine.priorities.systemSummary();
    setSummary(sm);

    const cId = selected === 'all' ? undefined : selected;
    const pList = cId
      ? kapocsEngine.priorities.forCitizen(cId)
      : sm.topPriorities;
    setPriorities(pList);
  }, [selected, tick]);

  // Auto-tick 3s-onként
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 3000);
    return () => clearInterval(t);
  }, []);

  const dirs = ['north', 'east', 'south', 'west'] as const;

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">

      {/* Fejléc */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Emberközpontú Prioritás Kezelő</h2>
          <p className="text-xs text-slate-500 mt-1">Geo-matematikai súlyozással számított személyre szabott prioritások.</p>
        </div>
        <span className="px-3 py-1 bg-white border border-slate-200 rounded-full text-[10px] font-bold text-slate-500 uppercase">
          Tick #{kapocsEngine.step}
        </span>
      </div>

      {/* Rendszer összesítő */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {dirs.map(d => {
          const s = DIR_STYLE[d];
          return (
            <div key={d} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-black" style={{ background: s.color + '22', color: s.color }}>
                  {s.label}
                </div>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{s.badge}</span>
              </div>
              <p className="text-2xl font-black text-slate-800">{summary.byDir[d]}</p>
              <p className="text-[9px] text-slate-400">aktív prioritás</p>
            </div>
          );
        })}
      </div>

      {/* Szűrő */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-bold text-slate-500 uppercase">Polgár szűrő:</span>
        <button
          onClick={() => setSelected('all')}
          className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${selected === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
        >
          Mindenki ({summary.totalActive})
        </button>
        {citizens.map(c => (
          <button
            key={c.id}
            onClick={() => setSelected(c.id)}
            className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${selected === c.id ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Prioritás kártyák */}
      {priorities.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          <div className="text-3xl mb-2">⏳</div>
          Geo-réteg számítás folyamatban...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {priorities.map(p => (
            <PriorityCard key={p.id} p={p} />
          ))}
        </div>
      )}

      {/* Rendszer magyarázat */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-3">Hogyan működik?</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-500 leading-relaxed">
          <p><strong className="text-slate-700">Személyes Geo-Réteg:</strong> Minden polgárnak egyedi Ézó mag-példánya van, amelyet az azonosítójából derivált seed inicializál. Ez adja a „digitális ujjlenyomatot".</p>
          <p><strong className="text-slate-700">Halmazok & Metszetek:</strong> Minden város halmazokra (zónákra) osztódik. A polgár geo-rétege kiszámítja a metszet erősségét minden halmazhoz.</p>
          <p><strong className="text-slate-700">Súlyozás:</strong> Metszet erő = geo-konfidencia × halmaz prioritás × polgár trust score. Tension ≥ 0.99 → 99%+ pontosság.</p>
          <p><strong className="text-slate-700">Prioritás Irányok:</strong> É=elemzés, K=cselekvés, D=döntő jóváhagyás, Ny=dokumentáció. Az irány a geo-matematikai szektorból ered.</p>
        </div>
      </div>
    </div>
  );
}
