/**
 * Ézó Mag Vizualizátor – Személyes geo-réteg animáció
 * VALÓDI EzoCore adatok, Math.random() nélkül.
 */

import { useEffect, useRef, useState } from 'react';
import { EzoCore } from '../lib/ezoCore';
import type { Citizen } from '../lib/types';

interface Props {
  citizen: Citizen;
}

const DIR_COLOR = { north: '#00d4ff', east: '#00ff88', south: '#ff4488', west: '#aa44ff' };

export function EzoVisualizer({ citizen }: Props) {
  const coreRef  = useRef<EzoCore | null>(null);
  const animRef  = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [accuracy, setAccuracy] = useState(0);
  const [angle,    setAngle]    = useState(0);
  const [stepN,    setStepN]    = useState(0);

  useEffect(() => {
    const tension   = citizen.trustLevel === 'ellenorzott' ? 0.99
                    : citizen.trustLevel === 'magas'       ? 0.93
                    : citizen.trustLevel === 'kozepes'     ? 0.85 : 0.72;
    const core = new EzoCore(citizen.id, tension);

    // Betöltjük a citizen adatait
    const enc = new TextEncoder();
    core.loadBinary(enc.encode(`${citizen.kapocsTokemId}|${citizen.name}|${citizen.settlementId}`));
    // Speciális irány-markerek
    core.insertAt(0,   255);
    core.insertAt(90,  200);
    core.insertAt(180, 255);
    core.insertAt(270, 200);

    coreRef.current = core;

    function draw() {
      const canvas = canvasRef.current;
      if (!canvas || !coreRef.current) return;
      const ctx    = canvas.getContext('2d');
      if (!ctx) return;
      const W = canvas.width, H = canvas.height;
      const cx = W / 2, cy = H / 2;

      core.tick();
      const snap   = core.snapshot();
      const slots  = core.getRawSlots();
      const reticle = snap.reticleAngle;

      setAngle(+reticle.toFixed(1));
      setStepN(snap.step);
      setAccuracy(snap.avgConfidence * 100);

      // Háttér
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0a0a1a';
      ctx.fillRect(0, 0, W, H);

      // Radiális rács
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      for (let r = 20; r <= 90; r += 20) {
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      }
      for (let a = 0; a < 360; a += 45) {
        const rad = a * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(rad) * 90, cy + Math.sin(rad) * 90);
        ctx.stroke();
      }

      // Byte részecskék
      for (let i = 0; i < 360; i++) {
        const byte   = slots[i];
        if (byte === 0) continue;
        const angle  = (i * Math.PI) / 180;
        const r      = 38 + (byte / 255) * 45;
        const x      = cx + Math.cos(angle) * r;
        const y      = cy + Math.sin(angle) * r;

        // Szín irány alapján
        const dir = i < 45 || i >= 315 ? DIR_COLOR.north
                  : i < 135 ? DIR_COLOR.east
                  : i < 225 ? DIR_COLOR.south
                  : DIR_COLOR.west;

        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = dir + 'cc';
        ctx.fill();
      }

      // Reticle kar
      const retRad  = (reticle - 90) * Math.PI / 180;
      const retLen  = 80;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(retRad) * retLen, cy + Math.sin(retRad) * retLen);
      ctx.strokeStyle = '#ff4488';
      ctx.lineWidth   = 2;
      ctx.shadowColor = '#ff4488';
      ctx.shadowBlur  = 8;
      ctx.stroke();
      ctx.shadowBlur  = 0;

      // Közép kör
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0a1a';
      ctx.fill();
      ctx.strokeStyle = '#ff4488';
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // ÉZÓ felirat
      ctx.fillStyle = '#ff4488';
      ctx.font      = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ÉZÓ', cx, cy);

      // Irány-jelek
      const labels: [string, number, number][] = [
        ['É', cx, cy - 98], ['K', cx + 98, cy], ['D', cx, cy + 98], ['Ny', cx - 98, cy],
      ];
      ctx.font = 'bold 9px monospace';
      for (const [label, lx, ly] of labels) {
        ctx.fillStyle = label === 'É' ? DIR_COLOR.north : label === 'K' ? DIR_COLOR.east : label === 'D' ? DIR_COLOR.south : DIR_COLOR.west;
        ctx.fillText(label, lx, ly);
      }

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [citizen.id]);

  return (
    <div className="flex flex-col bg-slate-900 rounded-2xl overflow-hidden h-full min-h-[280px] relative">
      <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_center,_#4f46e5_0%,_transparent_70%)]" />

      <div className="relative z-10 flex justify-between items-center px-4 pt-3 pb-1">
        <div>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Geo-Réteg</p>
          <p className="text-xs font-bold text-white truncate">{citizen.name}</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] text-slate-400">Lépés: <span className="text-cyan-400 font-mono">{stepN}</span></p>
          <p className="text-[9px] text-slate-400">Szög: <span className="text-pink-400 font-mono">{angle}°</span></p>
        </div>
      </div>

      <div className="relative z-10 flex-1 flex items-center justify-center">
        <canvas ref={canvasRef} width={200} height={200} />
      </div>

      <div className="relative z-10 px-4 pb-3">
        <div className="bg-slate-800/70 rounded-xl p-2 border border-slate-700">
          <div className="flex justify-between mb-1">
            <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Pontosság</span>
            <span className="text-[9px] font-bold" style={{ color: accuracy > 90 ? '#00ff88' : '#f59e0b' }}>
              {accuracy.toFixed(1)}%
            </span>
          </div>
          <div className="w-full h-1 bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${accuracy}%`, background: accuracy > 90 ? '#00ff88' : '#f59e0b' }} />
          </div>
          <p className="text-[8px] text-slate-500 mt-1 font-mono truncate">{citizen.kapocsTokemId}</p>
        </div>
      </div>
    </div>
  );
}
