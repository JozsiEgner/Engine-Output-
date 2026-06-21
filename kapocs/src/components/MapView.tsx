/**
 * Térkép nézet – Dinamikus halmazok + metszetek az összes polgárhoz.
 */

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Circle, Polygon, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { kapocsEngine }  from '../lib/ezoKapocs';
import type { Metszet, Citizen } from '../lib/types';
import { pct } from '../lib/utils';

const HALMAZ_ALPHA = '33';

export function MapView() {
  const [isClient,  setIsClient]  = useState(false);
  const [citizens,  setCitizens]  = useState<Citizen[]>([]);
  const [metszetek, setMetszetek] = useState<Record<string, Metszet[]>>({});
  const [selected,  setSelected]  = useState<string>('');
  const [tick,      setTick]      = useState(0);

  useEffect(() => { setIsClient(true); }, []);

  useEffect(() => {
    kapocsEngine.init();
    const all = kapocsEngine.registry.allCitizens();
    setCitizens(all);
    if (all.length && !selected) setSelected(all[0].id);
  }, []);

  useEffect(() => {
    if (!selected) return;
    kapocsEngine.tickAll();
    const res: Record<string, Metszet[]> = {};
    for (const c of kapocsEngine.registry.allCitizens()) {
      const r = kapocsEngine.processCitizen(c.id);
      if (r) res[c.id] = r.metszetek;
    }
    setMetszetek(res);
  }, [selected, tick]);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 4000);
    return () => clearInterval(t);
  }, []);

  const settlements = kapocsEngine.settlements.all();
  const allHalmazok = settlements.flatMap(s => s.halmazok);
  const selectedMets = selected ? (metszetek[selected] ?? []) : [];

  const center: [number, number] = [47.4979, 19.0402];

  return (
    <div className="h-full flex flex-col gap-5 pb-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">
            Geoszámító Réteg: <span className="text-indigo-600">Emberközpontú Nézet</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">Települési halmazok és személyes metszetek valós-idejű megjelenítése.</p>
        </div>
        <span className="px-3 py-1 bg-white border border-slate-200 rounded-full text-[10px] font-bold text-slate-500 uppercase">
          Metszetek: Aktív
        </span>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-5">
        {/* Térkép */}
        <div className="flex-1 bg-white p-2 rounded-3xl border border-slate-200 shadow-inner relative overflow-hidden min-h-[400px]">
          {isClient ? (
            <MapContainer center={center} zoom={11} className="w-full h-full rounded-2xl z-0" zoomControl={false}>
              <TileLayer
                attribution='&copy; <a href="https://openstreetmap.org/copyright">OSM</a>'
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              />

              {/* Halmazok */}
              {allHalmazok.map(h => (
                <Circle
                  key={h.id}
                  center={h.center}
                  radius={h.radius}
                  pathOptions={{ color: h.color ?? '#4f46e5', fillColor: h.color ?? '#4f46e5', weight: 1.5, fillOpacity: 0.12 }}
                >
                  <Popup>
                    <div className="font-bold text-sm">{h.name}</div>
                    <div className="text-[10px] text-slate-500 mt-1">Prioritás: {(h.priority * 100).toFixed(0)}%</div>
                    <div className="text-[10px] text-slate-500">Típus: {h.type}</div>
                  </Popup>
                </Circle>
              ))}

              {/* Aktív polgár metszetei */}
              {selectedMets.map(m => {
                const halmaz = allHalmazok.find(h => h.id === m.halmazId);
                if (!halmaz || !halmaz.bounds.length) return null;
                const color = m.dir === 'north' ? '#00d4ff'
                            : m.dir === 'east'  ? '#00ff88'
                            : m.dir === 'south' ? '#ff4488' : '#aa44ff';
                return (
                  <Polygon
                    key={m.id}
                    positions={halmaz.bounds}
                    pathOptions={{ color, fillColor: color, fillOpacity: 0.25, weight: 2 }}
                  >
                    <Popup>
                      <div className="font-bold text-sm">Metszet: {halmaz.name}</div>
                      <div className="text-[10px] text-slate-500 mt-1">Erő: {pct(m.strength)}</div>
                      <div className="text-[10px] text-slate-500">Irány: {m.dir.toUpperCase()}</div>
                      <div className="text-[10px] text-slate-500">Konfidencia: {pct(m.confidence)}</div>
                    </Popup>
                  </Polygon>
                );
              })}
            </MapContainer>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-slate-50 rounded-2xl">
              <span className="text-sm font-bold text-slate-400">Térkép betöltése...</span>
            </div>
          )}

          {/* Jelmagyarázat */}
          <div className="absolute bottom-6 left-6 flex flex-col gap-1.5 z-[1000]">
            {[
              { color: '#4f46e5', label: 'Halmaz zóna' },
              { color: '#00d4ff', label: 'É – Elemzési metszet' },
              { color: '#00ff88', label: 'K – Cselekvési metszet' },
              { color: '#ff4488', label: 'D – Döntői metszet' },
              { color: '#aa44ff', label: 'Ny – Tanulási metszet' },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-2 bg-white/80 backdrop-blur p-1.5 rounded-lg border border-slate-100 shadow-sm">
                <div className="w-3 h-3 rounded" style={{ background: l.color + '55', border: `1.5px solid ${l.color}` }} />
                <span className="text-[9px] font-medium text-slate-600">{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Oldalpanel */}
        <div className="w-full lg:w-80 bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-5">
          <div>
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Polgár választó</h3>
            <div className="space-y-2">
              {citizens.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                  className={`w-full text-left p-2.5 rounded-xl border transition-all ${selected === c.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}
                >
                  <p className="text-xs font-bold text-slate-800">{c.name}</p>
                  <p className="text-[9px] text-slate-400">{c.kapocsTokemId}</p>
                  <p className="text-[9px] font-bold text-emerald-600">{c.trustLevel}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Aktív metszetek */}
          <div className="flex-1">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              Aktív Metszetek ({selectedMets.length})
            </h3>
            <div className="space-y-2">
              {selectedMets.length === 0 && (
                <p className="text-[10px] text-slate-400">Nincs aktív metszet. Geo-számítás fut...</p>
              )}
              {selectedMets.map(m => {
                const halmaz = allHalmazok.find(h => h.id === m.halmazId);
                const color  = m.dir === 'north' ? '#00d4ff' : m.dir === 'east' ? '#00ff88' : m.dir === 'south' ? '#ff4488' : '#aa44ff';
                return (
                  <div key={m.id} className="p-2.5 rounded-xl border border-slate-200 bg-slate-50">
                    <div className="flex justify-between items-start">
                      <p className="text-[10px] font-bold text-slate-700 leading-tight">{halmaz?.name ?? m.halmazId}</p>
                      <span className="text-[9px] font-black" style={{ color }}>{pct(m.strength)}</span>
                    </div>
                    <div className="w-full h-1 bg-slate-200 rounded-full mt-1.5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: pct(m.strength), background: color }} />
                    </div>
                    <p className="text-[8px] text-slate-400 mt-1">Irány: {m.dir.toUpperCase()} • Conf: {pct(m.confidence)}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Átláthatóság */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-slate-700">Átláthatósági Kapu</span>
              <div className="w-8 h-4 bg-indigo-600 rounded-full relative cursor-pointer">
                <div className="w-3 h-3 bg-white rounded-full absolute top-0.5 right-0.5" />
              </div>
            </div>
            <p className="text-[9px] text-slate-400">Hitelesített ügyvédi és banki rétegek számára látható.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
