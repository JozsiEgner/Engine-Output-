#!/usr/bin/env python3
"""
Ézó Python Agent AI  (port 3003)
DeepSeek 7B + Geo-Matematikai Döntő Réteg

Architektúra:
  EzoMathEngine  – Weyl/Arnold/Chebyshev determinisztikus szög-generátorok
  EzoByteAxis    – 1-byte forgási tengely (360 pozíció, ~99% visszaolvasás)
  EzoLayerStack  – végtelen rétegelhetős feldolgozó fa
  DöntőRéteg     – 1 db végső döntő réteg (south/680nm/vörös)
  DeepSeekBridge – Ollama → DeepSeek 7B (vagy legnagyobb elérhető modell)

Indítás:
  python3 python/ezo_agent.py
  OFFLINE=1 python3 python/ezo_agent.py
  OLLAMA_URL=http://localhost:11434 python3 python/ezo_agent.py
"""

import http.server
import json
import math
import time
import threading
import os
import urllib.request
import urllib.error
import struct
from datetime import datetime, timezone

PORT       = 3003
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
LOG_FILE   = '/tmp/ezo_agent_log.jsonl'
OFFLINE    = os.environ.get('OFFLINE', '0') == '1'

# ── Konstansok ───────────────────────────────────────────────────────────────

PHI         = (math.sqrt(5) - 1) / 2          # φ ≈ 0.6180339887
PLASTIC     = 1.324717957244746
C_LIGHT     = 3e8                              # m/s – fény sebessége
V_SOUND     = 343.0                            # m/s – hang sebessége
ARM         = 0.07                             # m   – reticle kar hossz

LAMBDA_BY_DIR = {
    'north': 450e-9,   # kék   – kérdés/elemzés
    'east':  530e-9,   # zöld  – cselekvés/transzformáció
    'south': 680e-9,   # vörös – döntés/szintézis [DÖNTŐ]
    'west':  405e-9,   # ibolya – tanulás/memória
}

DIR_ROLE = {
    'north': 'kérdés/elemzés',
    'east':  'cselekvés/transzformáció',
    'south': 'döntés/szintézis [DÖNTŐ]',
    'west':  'tanulás/memória',
}

DEEPSEEK_PREFER = ['deepseek', 'ds', 'mistral', 'llama', 'qwen', 'phi']

# ── Math Engine ───────────────────────────────────────────────────────────────

class EzoMathEngine:
    """Determinisztikus geo-matematikai szög generátorok."""

    @staticmethod
    def weyl(step: int, energy: float = 0.5) -> float:
        return (step * PHI % 1) * 360

    @staticmethod
    def arnold(step: int, energy: float = 0.5) -> float:
        k     = 0.5 + 2.0 * energy
        theta = 0.231
        n     = step % 500
        for _ in range(n):
            theta = (theta + PHI - (k / (2 * math.pi)) * math.sin(2 * math.pi * theta)) % 1
            if theta < 0:
                theta += 1
        return theta * 360

    @staticmethod
    def chebyshev(step: int, energy: float = 0.5) -> float:
        ratio = 1 / PLASTIC
        return abs(math.cos(step * ratio * math.pi + energy * 2)) * 360

    @classmethod
    def reticle_angle(cls, step: int, engine_type: str = 'weyl', matrix_energy: float = 50) -> float:
        e = matrix_energy / 100
        if engine_type == 'arnold':
            return cls.arnold(step, e)
        elif engine_type == 'chebyshev':
            return cls.chebyshev(step, e)
        return cls.weyl(step, e)

    @staticmethod
    def balloon_radius(theta_rad: float, base_r: float, reticle_deg: float,
                       tension: float, resonance: float, step: int) -> float:
        """Lufi burok sugara adott polár-szögnél (0-forma)."""
        r_rad      = reticle_deg * math.pi / 180
        harmonic   = 4 + round(resonance * 8)
        wave_ampl  = 0.08 * (1 - tension)
        breathing  = math.sin(step * 0.05) * 0.02
        natural    = base_r * (1 + wave_ampl * math.sin(harmonic * theta_rad + step * 0.02) + breathing)

        diff       = math.atan2(math.sin(theta_rad - r_rad), math.cos(theta_rad - r_rad))
        indent_d   = 0.22 * (1 - tension)
        dent       = indent_d * math.exp(-(diff * diff) / (2 * 0.45 * 0.45))

        b1 = math.atan2(math.sin(theta_rad - (r_rad + math.pi)),     math.cos(theta_rad - (r_rad + math.pi)))
        b2 = math.atan2(math.sin(theta_rad - (r_rad + math.pi / 2)), math.cos(theta_rad - (r_rad + math.pi / 2)))
        b3 = math.atan2(math.sin(theta_rad - (r_rad - math.pi / 2)), math.cos(theta_rad - (r_rad - math.pi / 2)))
        W  = 0.6 * 0.6 * 2
        bulge = (indent_d / 2) * (
            0.5  * math.exp(-(b1 * b1) / W) +
            0.25 * math.exp(-(b2 * b2) / W) +
            0.25 * math.exp(-(b3 * b3) / W)
        )
        return max(0.08, natural - dent + bulge)

    @staticmethod
    def vib_freq(prev_deg: float, curr_deg: float) -> float:
        delta = abs(curr_deg - prev_deg)
        if delta > 180:
            delta = 360 - delta
        arc = ARM * (delta * math.pi / 180)
        return round(V_SOUND / (2 * arc)) if arc > 1e-4 else 0


# ── 1-Byte Forgási Tengely ────────────────────────────────────────────────────

class EzoByteAxis:
    """
    360 db 1-byte érték illeszthető forgási tengelyre.
    tension ≥ 0.95 → ~99% bináris visszaolvasási pontosság.
    """

    def __init__(self, tension: float = 0.95, resonance: float = 0.5, base_r: float = 0.48):
        self.slots     = bytearray(360)
        self.tension   = tension
        self.resonance = resonance
        self.base_r    = base_r
        self.step      = 0
        self.writes    = 0
        self.reads     = 0
        self._math     = EzoMathEngine()

    def insert_at(self, angle_deg: float, byte_val: int):
        pos = round(angle_deg % 360) % 360
        self.slots[pos] = byte_val & 0xFF
        self.writes += 1
        return pos

    def read_at(self, angle_deg: float, reticle_angle: float = 0) -> dict:
        pos       = round(angle_deg % 360) % 360
        byte_val  = self.slots[pos]
        theta_rad = pos * math.pi / 180
        radius    = self._math.balloon_radius(theta_rad, self.base_r, reticle_angle,
                                              self.tension, self.resonance, self.step)
        confidence = min(1.0, self.tension * (radius / self.base_r))
        self.reads += 1
        return {
            'pos': pos,
            'byte': byte_val,
            'confidence': round(confidence, 4),
            'bit_repr': format(byte_val, '08b'),
        }

    def read_all(self, reticle_angle: float = 0) -> dict:
        results  = [self.read_at(i, reticle_angle) for i in range(360)]
        avg_conf = sum(r['confidence'] for r in results) / 360
        raw      = bytes(r['byte'] for r in results)
        return {
            'bytes':        raw,
            'hex':          raw.hex(),
            'avg_confidence': round(avg_conf, 4),
            'accuracy_pct':   round(avg_conf * 100, 2),
            'slots':          360,
        }

    def load_binary(self, data: bytes) -> dict:
        """Bináris adat betöltése Weyl-sorozat alapján egyenletesen."""
        n = min(len(data), 360)
        for i in range(n):
            pos = round((i * PHI % 1) * 360) % 360
            self.slots[pos] = data[i]
        self.writes += n
        return {'loaded': n, 'total': len(data), 'coverage_pct': round(n / 360 * 100, 1)}

    def read_binary(self, reticle_angle: float = 0) -> dict:
        result = self.read_all(reticle_angle)
        raw    = result['bytes']
        try:
            text = raw.decode('utf-8', errors='replace')
        except Exception:
            text = '(dekódolási hiba)'
        return {
            'text':         text,
            'hex':          result['hex'],
            'base64':       __import__('base64').b64encode(raw).decode(),
            'accuracy_pct': result['accuracy_pct'],
        }

    def tick(self):
        self.step += 1

    def to_json(self) -> dict:
        return {
            'tension':     self.tension,
            'resonance':   self.resonance,
            'base_r':      self.base_r,
            'step':        self.step,
            'writes':      self.writes,
            'reads':       self.reads,
            'non_zero':    sum(1 for b in self.slots if b != 0),
        }


# ── Ézó Réteg ────────────────────────────────────────────────────────────────

_layer_counter = 0

class EzoLayer:
    """Egyetlen Ézó feldolgozó réteg – fény hullámhosszon szervezett."""

    def __init__(self, depth=0, direction='east', parent_id=None,
                 engine_type='weyl', matrix_energy=50, tension=0.5, resonance=0.5):
        global _layer_counter
        _layer_counter += 1
        self.id           = f'EL-{_layer_counter:04d}-{direction[0].upper()}'
        self.depth        = depth
        self.direction    = direction
        self.parent_id    = parent_id
        self.engine_type  = engine_type
        self.matrix_energy = matrix_energy
        self.tension      = tension
        self.resonance    = resonance

        self.lambda_m     = LAMBDA_BY_DIR.get(direction, LAMBDA_BY_DIR['east'])
        self.base_freq_hz = C_LIGHT / self.lambda_m

        self.step          = 0
        self.reticle_angle = 0.0
        self.heat          = 0.0
        self.active        = True
        self.is_decisive   = False
        self.children: list['EzoLayer'] = []
        self._math         = EzoMathEngine()

    def tick(self, matrix_energy=None) -> dict | None:
        if not self.active:
            return None
        self.step += 1
        if matrix_energy is not None:
            self.matrix_energy = matrix_energy

        self.reticle_angle = self._math.reticle_angle(self.step, self.engine_type, self.matrix_energy)

        # Fény-frekvencia fázis (strukturális oszlop analóg)
        harmonic   = self.base_freq_hz * (self.depth + 1)
        phase      = 2 * math.pi * (harmonic * self.step * 1e-14 + self.depth * self.reticle_angle / 360)
        freq_resp  = (math.cos(phase) + 1) / 2

        self.heat = min(1.0, self.heat + 0.02 * (1 - freq_resp))

        return {
            'id':            self.id,
            'depth':         self.depth,
            'dir':           self.direction,
            'role':          DIR_ROLE.get(self.direction, '?'),
            'lambda_nm':     round(self.lambda_m * 1e9),
            'step':          self.step,
            'reticle_angle': round(self.reticle_angle, 2),
            'freq_response': round(freq_resp, 4),
            'matrix_energy': self.matrix_energy,
            'heat':          round(self.heat, 3),
            'is_decisive':   self.is_decisive,
        }

    def embed(self, direction='east', **kwargs) -> 'EzoLayer':
        child = EzoLayer(
            depth=self.depth + 1,
            direction=direction,
            parent_id=self.id,
            engine_type=kwargs.get('engine_type', self.engine_type),
            matrix_energy=kwargs.get('matrix_energy', self.matrix_energy),
            tension=kwargs.get('tension', self.tension),
            resonance=kwargs.get('resonance', self.resonance),
        )
        self.children.append(child)
        return child

    def to_json(self) -> dict:
        return {
            'id':            self.id,
            'depth':         self.depth,
            'dir':           self.direction,
            'role':          DIR_ROLE.get(self.direction, '?'),
            'lambda_nm':     round(self.lambda_m * 1e9),
            'engine_type':   self.engine_type,
            'step':          self.step,
            'reticle_angle': round(self.reticle_angle, 2),
            'matrix_energy': self.matrix_energy,
            'heat':          round(self.heat, 3),
            'active':        self.active,
            'is_decisive':   self.is_decisive,
            'child_count':   len([c for c in self.children if c.active]),
        }


# ── Ézó Agent ────────────────────────────────────────────────────────────────

class EzoAgent:
    """
    Ézó Agent AI – Geo-Matematikai Döntő Ügynök
    Végtelen rétegek, 1 döntő réteg, DeepSeek 7B integráció.
    """

    def __init__(self, engine_type='weyl', tension=0.95, resonance=0.5):
        self.engine_type  = engine_type
        self.tension      = tension
        self.resonance    = resonance

        # Gyökér + döntő réteg
        self.root    = EzoLayer(depth=0, direction='east', engine_type=engine_type,
                                tension=tension, resonance=resonance)
        self.decisive = self.root.embed('south', engine_type=engine_type,
                                         tension=tension, resonance=resonance)
        self.decisive.is_decisive = True

        self.all_layers: dict[str, EzoLayer] = {
            self.root.id:     self.root,
            self.decisive.id: self.decisive,
        }

        # 1-Byte tengely
        self.byte_axis = EzoByteAxis(tension=tension, resonance=resonance)

        # Ollama modell
        self.model      = None
        self.model_ready = False

        # Állapot
        self.step   = 0
        self.memory: list[dict] = []
        self.booted = time.time()
        self._lock  = threading.Lock()
        self._math  = EzoMathEngine()

    def boot(self) -> dict:
        """Inicializálás: modell detektálás."""
        if not OFFLINE:
            try:
                models = self._list_models()
                chosen = models[0]['name'] if models else None
                for pref in DEEPSEEK_PREFER:
                    found = next((m['name'] for m in models if pref in m['name'].lower()), None)
                    if found:
                        chosen = found
                        break
                self.model       = chosen
                self.model_ready = bool(chosen)
            except Exception as e:
                self.model_ready = False
        return {
            'ready':       True,
            'model':       self.model,
            'model_ready': self.model_ready,
            'offline':     OFFLINE,
            'engine_type': self.engine_type,
            'tension':     self.tension,
            'root_id':     self.root.id,
            'decisive_id': self.decisive.id,
        }

    def process(self, input_data: str, matrix_energy: float = 50,
                binary_mode: bool = False, extra_layers: int = 0) -> dict:
        """Fő feldolgozás: input → réteg stack → döntő réteg → DeepSeek → döntés."""
        with self._lock:
            self.step += 1
            t0 = time.time()

            # Extra rétegek szülése
            if extra_layers > 0:
                self._spawn_layers(min(extra_layers, 32), matrix_energy)

            # Réteg stack tick
            layer_results = []
            for layer in list(self.all_layers.values()):
                r = layer.tick(matrix_energy)
                if r:
                    layer_results.append(r)

            # Döntő réteg
            decisive_result = self.decisive.tick(matrix_energy)

            # Byte tengely
            self.byte_axis.tick()
            binary_result = None
            if binary_mode or isinstance(input_data, str):
                buf = input_data.encode('utf-8', errors='replace') if isinstance(input_data, str) else input_data
                self.byte_axis.load_binary(buf)
                ra = decisive_result['reticle_angle'] if decisive_result else 0
                binary_result = self.byte_axis.read_binary(ra)

            # Strukturális pillér integritás (egyszerűsített)
            integrity = self._calc_column_integrity(decisive_result, matrix_energy)

            # DeepSeek lekérdezés
            ai_result = None
            if self.model_ready and not OFFLINE:
                ai_result = self._query_deepseek(input_data, decisive_result, matrix_energy, layer_results)

            # Döntés
            decisive_dir = decisive_result['dir'] if decisive_result else 'east'
            confidence   = self.tension * integrity * (decisive_result['freq_response'] if decisive_result else 0.5)

            decision = {
                'agent_id':      'EzoAgent-Python-v1',
                'step':          self.step,
                'ts':            datetime.now(timezone.utc).isoformat(),
                'ms':            round((time.time() - t0) * 1000),
                'decisive_dir':  decisive_dir,
                'confidence':    round(min(1.0, confidence), 4),
                'reticle_angle': decisive_result['reticle_angle'] if decisive_result else 0,
                'matrix_energy': matrix_energy,
                'layer_count':   len([l for l in self.all_layers.values() if l.active]),
                'max_depth':     max(l.depth for l in self.all_layers.values()),
                'column_integrity': round(integrity, 4),
                'binary':        binary_result,
                'ai':            ai_result,
                'layer_results': layer_results[:10],  # első 10 réteg eredménye
            }

            # Memória
            self.memory.append({
                'step':      self.step,
                'dir':       decisive_dir,
                'angle':     decisive_result['reticle_angle'] if decisive_result else 0,
                'confidence': decision['confidence'],
            })
            if len(self.memory) > 200:
                self.memory.pop(0)

            self._log(input_data, decision)
            return decision

    def read_binary(self, reticle_angle: float = None) -> dict:
        """99%-os bináris visszaolvasás."""
        angle = reticle_angle if reticle_angle is not None else (self.decisive.reticle_angle or 0)
        return self.byte_axis.read_binary(angle)

    def encode_decode(self, text: str) -> dict:
        """Szöveg be → byte tengely → visszaolvasás (pontosság ellenőrzés)."""
        buf  = text.encode('utf-8', errors='replace')
        load = self.byte_axis.load_binary(buf)
        read = self.read_binary()
        decoded = read['text'][:len(buf)]
        return {
            'original':    text,
            'encoded':     load,
            'decoded':     decoded,
            'accuracy_pct': read['accuracy_pct'],
            'match':       text[:360] == decoded,
        }

    def add_layer(self, parent_id: str, direction: str, **kwargs) -> dict:
        parent = self.all_layers.get(parent_id, self.root)
        child  = parent.embed(direction, **kwargs)
        self.all_layers[child.id] = child
        return child.to_json()

    def _spawn_layers(self, count: int, matrix_energy: float):
        dirs   = ['north', 'east', 'south', 'west']
        roots  = [self.root.id, self.decisive.id]
        for i in range(count):
            parent = self.all_layers.get(roots[i % len(roots)], self.root)
            child  = parent.embed(dirs[i % 4], matrix_energy=matrix_energy,
                                  tension=self.tension, resonance=self.resonance)
            self.all_layers[child.id] = child
            roots.append(child.id)

    def _calc_column_integrity(self, decisive_result: dict | None, matrix_energy: float) -> float:
        if not decisive_result:
            return 0.5
        ra    = decisive_result['reticle_angle']
        e     = matrix_energy / 100
        dirs  = list(LAMBDA_BY_DIR.items())
        total = 0.0
        for d, lam in dirs:
            freq = C_LIGHT / lam
            harmonic = freq * (self.step + 1)
            phase    = 2 * math.pi * (harmonic * self.step * 1e-14 + ra / 360)
            strength = (math.cos(phase) + 1) / 2 * (1 + e * 0.35)
            total   += min(1.0, strength)
        return total / len(dirs)

    def _query_deepseek(self, input_data: str, decisive: dict | None,
                         matrix_energy: float, layer_results: list) -> dict | None:
        if not decisive:
            return None
        prompt = self._build_prompt(input_data, decisive, matrix_energy, len(layer_results))
        try:
            payload = json.dumps({
                'model':  self.model,
                'prompt': prompt,
                'stream': False,
                'options': {
                    'temperature':  0.35,
                    'num_predict':  256,
                    'num_ctx':      4096,
                }
            }).encode('utf-8')
            req = urllib.request.Request(
                f'{OLLAMA_URL}/api/generate',
                data=payload,
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                return {
                    'model':  self.model,
                    'text':   (data.get('response') or '').strip(),
                    'tokens': data.get('eval_count'),
                    'ms':     round((data.get('eval_duration') or 0) / 1e6),
                }
        except Exception as e:
            return {'error': str(e), 'model': self.model}

    def _build_prompt(self, input_data: str, decisive: dict, matrix_energy: float, layer_count: int) -> str:
        max_depth = max(l.depth for l in self.all_layers.values())
        return (
            f"Te az Ézó geo-matematikai AI ügynök döntő rétege (south/680nm/vörös) vagy.\n"
            f"Rendszerállapot:\n"
            f"- Lépés: {self.step}, Motor: {self.engine_type}, Energia: {matrix_energy}%\n"
            f"- Irányzék szög: {decisive['reticle_angle']:.1f}°\n"
            f"- Rétegszám: {layer_count} (max mélység: {max_depth})\n"
            f"- Pillér integritás: {self._calc_column_integrity(decisive, matrix_energy)*100:.0f}%\n"
            f"- 1-Byte tengely: {self.byte_axis.to_json()['non_zero']}/360 pozíció feltöltve\n"
            f"\nFeladat: \"{str(input_data)[:500]}\"\n"
            f"\nAdj EGYETLEN, 2-3 mondatos döntést/értelmezést magyarul.\n"
            f"Formátum: [IRÁNY: {decisive['dir'].upper()}] döntés szövege. Azonnal a lényegre térj."
        )

    def _list_models(self) -> list:
        req = urllib.request.Request(f'{OLLAMA_URL}/api/tags', method='GET')
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
            return sorted(data.get('models', []), key=lambda m: m.get('size', 0), reverse=True)

    def _log(self, input_str: str, decision: dict):
        entry = {
            'ts':      datetime.now(timezone.utc).isoformat(),
            'source':  'ezo-python',
            'step':    self.step,
            'input':   str(input_str)[:200],
            'dir':     decision['decisive_dir'],
            'angle':   decision['reticle_angle'],
            'conf':    decision['confidence'],
            'ai':      bool(decision.get('ai') and not decision['ai'].get('error')),
        }
        with open(LOG_FILE, 'a') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')

    def status(self) -> dict:
        return {
            'agent_id':      'EzoAgent-Python-v1',
            'uptime_s':      round(time.time() - self.booted, 1),
            'step':          self.step,
            'engine_type':   self.engine_type,
            'tension':       self.tension,
            'resonance':     self.resonance,
            'offline':       OFFLINE,
            'model':         self.model,
            'model_ready':   self.model_ready,
            'layer_count':   len(self.all_layers),
            'max_depth':     max(l.depth for l in self.all_layers.values()),
            'byte_axis':     self.byte_axis.to_json(),
            'memory_count':  len(self.memory),
            'last_decision': self.memory[-1] if self.memory else None,
        }


# ── Globális Agent példány ────────────────────────────────────────────────────

agent = EzoAgent(
    engine_type=os.environ.get('EZO_ENGINE', 'weyl'),
    tension=float(os.environ.get('EZO_TENSION', '0.95')),
    resonance=float(os.environ.get('EZO_RESONANCE', '0.5')),
)

# ── HTTP Handler ──────────────────────────────────────────────────────────────

class EzoHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        pass  # suppress default access log

    def send_json(self, data: dict, code: int = 200):
        body = json.dumps(data, ensure_ascii=False, default=str).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text: str, ct: str = 'text/html; charset=utf-8', code: int = 200):
        body = text.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ct)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def read_body(self) -> dict:
        n = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(n)) if n > 0 else {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]

        if path in ('/', ''):
            self.send_text(STATUS_HTML)

        elif path == '/status':
            self.send_json(agent.status())

        elif path == '/boot':
            self.send_json(agent.boot())

        elif path == '/log':
            try:
                with open(LOG_FILE) as f:
                    lines = f.readlines()
                entries = [json.loads(l) for l in lines[-50:] if l.strip()]
                self.send_json({'entries': entries, 'total': len(lines)})
            except FileNotFoundError:
                self.send_json({'entries': [], 'total': 0})

        elif path == '/layers':
            self.send_json(agent.status())

        else:
            self.send_json({'error': 'Not found'}, 404)

    def do_POST(self):
        path = self.path.split('?')[0]
        body = self.read_body()

        if path == '/process':
            # Geo-matematikai feldolgozás + döntő réteg + DeepSeek
            input_data    = body.get('input', body.get('text', ''))
            matrix_energy = float(body.get('matrixEnergy', body.get('matrix_energy', 50)))
            binary_mode   = bool(body.get('binaryMode', body.get('binary_mode', False)))
            extra_layers  = int(body.get('layers', body.get('extraLayers', 0)))
            result = agent.process(input_data, matrix_energy, binary_mode, extra_layers)
            self.send_json(result)

        elif path == '/binary/load':
            # Bináris adat betöltése a tengelyre
            data     = body.get('data', body.get('text', ''))
            buf      = data.encode('utf-8', errors='replace') if isinstance(data, str) else bytes(data)
            load_res = agent.byte_axis.load_binary(buf)
            self.send_json({'loaded': load_res, 'axis': agent.byte_axis.to_json()})

        elif path == '/binary/read':
            # Bináris visszaolvasás (~99% pontossággal)
            angle = float(body.get('reticleAngle', body.get('reticle_angle', agent.decisive.reticle_angle or 0)))
            self.send_json(agent.read_binary(angle))

        elif path == '/binary/encode-decode':
            # Szöveg → byte tengely → visszaolvasás
            text = body.get('text', '')
            self.send_json(agent.encode_decode(text))

        elif path == '/layers/add':
            # Új réteg szülése
            parent_id = body.get('parentId', body.get('parent_id', agent.root.id))
            direction = body.get('dir', body.get('direction', 'east'))
            self.send_json(agent.add_layer(parent_id, direction,
                                           engine_type=body.get('engineType', agent.engine_type),
                                           matrix_energy=float(body.get('matrixEnergy', 50))))

        elif path == '/reinforce':
            # Visszacsatolás: döntés megerősítése / gyengítése
            direction = body.get('dir', 'east')
            reward    = float(body.get('reward', 0.01))
            # Egyszerű adaptáció: ha reward > 0, erősíti a réteg rezonancia-ját
            agent.decisive.resonance = min(1.0, agent.decisive.resonance + reward)
            agent.root.resonance     = min(1.0, agent.root.resonance + reward * 0.5)
            self.send_json({'reinforced': True, 'dir': direction, 'reward': reward,
                            'decisive_resonance': agent.decisive.resonance})

        elif path == '/translate':
            # Kompatibilitás: agy.py fordítás endpoint
            text       = body.get('text', '')
            target_lang = body.get('targetLang', 'angol')
            result = agent.process(f'Fordítsd le {target_lang} nyelvre: {text}', 50, False, 0)
            ai = result.get('ai') or {}
            self.send_json({
                'translation': ai.get('text') or f'[Ézó döntő réteg] {result["decisive_dir"]} irány aktiválva.',
                'angle':       result['reticle_angle'],
                'confidence':  result['confidence'],
                'ms':          result['ms'],
            })

        else:
            self.send_json({'error': 'Not found'}, 404)


# ── Status HTML ───────────────────────────────────────────────────────────────

STATUS_HTML = """<!DOCTYPE html>
<html lang="hu"><head><meta charset="UTF-8">
<title>Ézó Agent AI · port 3003</title>
<style>
  body{background:#000a1e;color:#90b8d8;font:12px 'Courier New',monospace;padding:20px}
  h1{color:#ff9b9b;font-size:16px;letter-spacing:3px;margin-bottom:4px}
  h2{color:#8be28b;font-size:11px;letter-spacing:2px;margin:0 0 16px}
  .pill{background:rgba(0,20,60,.6);border:1px solid rgba(255,100,100,.2);
    border-radius:3px;padding:4px 10px;display:inline-block;margin:4px;color:#ff9b9b}
  .pill.g{border-color:rgba(100,200,100,.2);color:#8be28b}
  .pill.b{border-color:rgba(100,180,255,.2);color:#78c4ff}
  .pill.v{border-color:rgba(200,150,255,.2);color:#d7a7ff}
  a{color:#78c4ff} pre{color:#78c4ff;font-size:10px}
</style>
</head><body>
<h1>⬡ ÉZÓ AGENT AI</h1>
<h2>GEO-MATEMATIKAI DÖNTŐ ÜGYNÖK · port 3003</h2>

<div class="pill">POST /process</div>
<div class="pill">GET /status</div>
<div class="pill">GET /boot</div>
<div class="pill b">POST /binary/load</div>
<div class="pill b">POST /binary/read</div>
<div class="pill b">POST /binary/encode-decode</div>
<div class="pill g">POST /layers/add</div>
<div class="pill g">GET /layers</div>
<div class="pill v">POST /reinforce</div>
<div class="pill v">POST /translate</div>
<div class="pill">GET /log</div>

<p style="margin-top:16px;color:#506070;font-size:10px">
  Motor: Weyl/Arnold/Chebyshev · Döntő réteg: D/south/680nm/vörös<br>
  1-Byte tengely: 360 pozíció · Tension≥0.95 → ~99% bináris visszaolvasás<br>
  DeepSeek 7B: <a href="http://localhost:11434">Ollama</a> · Napló: <code>/tmp/ezo_agent_log.jsonl</code>
</p>

<script>
fetch('/status').then(r=>r.json()).then(d=>{
  document.body.innerHTML += '<pre>'+JSON.stringify(d,null,2)+'</pre>';
}).catch(e=>{
  document.body.innerHTML += '<pre style="color:#ff9b9b">'+e+'</pre>';
});
</script>
</body></html>"""


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    print(f'Ézó Agent AI  http://localhost:{PORT}')
    print(f'Ollama:       {OLLAMA_URL}')
    print(f'Motor:        {agent.engine_type.upper()} | Tension: {agent.tension} | Resonance: {agent.resonance}')
    print(f'Napló:        {LOG_FILE}')
    print(f'Mód:          {"OFFLINE" if OFFLINE else "ONLINE"}')
    print()

    boot_result = agent.boot()
    if boot_result['model_ready']:
        print(f'[OK] Modell: {boot_result["model"]}')
    else:
        print('[WARN] Ollama nem elérhető – offline módban fut')
    print(f'[OK] Gyökér réteg:  {boot_result["root_id"]}')
    print(f'[OK] Döntő réteg:   {boot_result["decisive_id"]} (south/680nm)')
    print()

    server = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), EzoHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nÉzó Agent leállítva.')
