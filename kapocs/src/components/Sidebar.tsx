import { LayoutDashboard, Map, Wallet, GitMerge } from 'lucide-react';

type View = 'dashboard' | 'map' | 'assets' | 'priority';

const NAV = [
  { id: 'dashboard' as View, icon: LayoutDashboard, label: 'Áttekintés' },
  { id: 'map'       as View, icon: Map,             label: 'Géo-Térkép'  },
  { id: 'assets'    as View, icon: Wallet,           label: 'Vagyon'      },
  { id: 'priority'  as View, icon: GitMerge,         label: 'Prioritások' },
];

interface Props {
  currentView: View;
  setCurrentView: (v: View) => void;
}

export function Sidebar({ currentView, setCurrentView }: Props) {
  return (
    <aside className="w-16 lg:w-56 bg-slate-900 flex flex-col shrink-0">
      <div className="h-16 flex items-center justify-center lg:justify-start lg:px-5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black text-xs">É</div>
          <span className="hidden lg:block text-sm font-bold text-white">Kapocs</span>
        </div>
      </div>

      <nav className="flex-1 py-4 flex flex-col gap-1 px-2">
        {NAV.map(item => {
          const active = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left w-full
                ${active
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              <item.icon className="w-4.5 h-4.5 shrink-0" />
              <span className="hidden lg:block text-sm font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-800">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          <span className="hidden lg:block text-[9px] font-bold text-slate-500 uppercase tracking-widest">Ézó-Core Aktív</span>
        </div>
      </div>
    </aside>
  );
}
