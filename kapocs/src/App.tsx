import { useState } from 'react';
import { Sidebar }         from './components/Sidebar';
import { Topbar }          from './components/Topbar';
import { Dashboard }       from './components/Dashboard';
import { MapView }         from './components/MapView';
import { Assets }          from './components/Assets';
import { PriorityManager } from './components/PriorityManager';

type View = 'dashboard' | 'map' | 'assets' | 'priority';

export default function App() {
  const [view, setView] = useState<View>('dashboard');

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans">
      <Sidebar currentView={view} setCurrentView={setView} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {view === 'dashboard' && <Dashboard />}
          {view === 'map'       && <MapView />}
          {view === 'assets'    && <Assets />}
          {view === 'priority'  && <PriorityManager />}
        </main>
        <footer className="h-10 bg-white border-t border-slate-200 px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_4px_rgba(16,185,129,0.5)]" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest hidden sm:inline">
                Hálózat: ÉZÓ-CORE
              </span>
            </div>
          </div>
          <div className="text-[10px] font-bold text-slate-400 hidden md:block">
            Ézó Kapocs Modul v1.0 – Emberközpontú Prioritás Kezelő
          </div>
        </footer>
      </div>
    </div>
  );
}
