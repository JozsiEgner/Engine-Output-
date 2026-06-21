#!/usr/bin/env python3
"""
Python AGY – 0-Roulette Brain  (port 3001)
Ollama: http://localhost:11434
Log:    /tmp/agy_log.jsonl  (shared format with Java AGY)

Indítás:
  python3 python/agy.py
  OFFLINE=1 python3 python/agy.py
"""
import http.server
import json
import math
import time
import threading
import os
import urllib.request
import urllib.error
from datetime import datetime, timezone

PORT       = 3001
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
LOG_FILE   = '/tmp/agy_log.jsonl'
OFFLINE    = os.environ.get('OFFLINE', '0') == '1'

# ── 0-Roulette Math ───────────────────────────────────────────────────────────
WEYL_ALPHA = (math.sqrt(5) - 1) / 2   # φ ≈ 0.6180339887

def weyl(seed, step):
    return (seed + step * WEYL_ALPHA) % 1.0

def arnold(x, y, n):
    for _ in range(n % 7 + 1):
        x, y = (x + y) % 1.0, (x + 2*y) % 1.0
    return x, y

def chebyshev_t(x, n):
    if n == 0: return 1.0
    if n == 1: return x
    a, b = 1.0, x
    for _ in range(n - 1):
        a, b = b, 2*x*b - a
    return max(-1.0, min(1.0, b))

# ── Thermal Bands ─────────────────────────────────────────────────────────────
BANDS = [
    dict(name='HŰVÖS',   max=0.30, color='#78c4ff', ctx_mult=1.00, pred_mult=1.00, delay=0),
    dict(name='MELEG',   max=0.60, color='#8be28b', ctx_mult=0.85, pred_mult=0.90, delay=0),
    dict(name='FORRÓ',   max=0.80, color='#ffc96b', ctx_mult=0.65, pred_mult=0.70, delay=80),
    dict(name='KRITIKUS',max=1.00, color='#ff9b9b', ctx_mult=0.40, pred_mult=0.50, delay=200),
]

def get_band(heat):
    for b in BANDS:
        if heat <= b['max']:
            return b
    return BANDS[-1]

# ── Cortex ────────────────────────────────────────────────────────────────────
class Cortex:
    def __init__(self):
        self.load = 0.0
        self.heat = 0.0
        self._lock = threading.Lock()

    def acquire(self, c=0.3):
        with self._lock:
            self.load = min(1.0, self.load + c)
            self.heat = min(1.0, self.heat + c * 0.35)

    def release(self, c=0.3):
        with self._lock:
            self.load = max(0.0, self.load - c * 0.7)
            self.heat = max(0.0, self.heat - c * 0.15)

    def throttle(self):
        with self._lock:
            b = get_band(self.heat)
            return {
                'num_ctx':     int(2048 * b['ctx_mult']),
                'num_predict': int(512  * b['pred_mult']),
                'delay_ms':    b['delay'],
                'band':        {'label': b['name'], 'color': b['color']}
            }

    def status(self):
        with self._lock:
            b = get_band(self.heat)
            return {
                'load':        round(self.load, 3),
                'heat':        round(self.heat, 3),
                'thermalBand': {'label': b['name'], 'color': b['color']},
                'source':      'python-agy',
                'port':        PORT
            }

# ── Math Engine ───────────────────────────────────────────────────────────────
class Engine:
    def __init__(self):
        self.step = 0
        self.seed = 0.31415
        self.ax, self.ay = 0.618, 0.414

    def tick(self):
        self.step += 1
        w         = weyl(self.seed, self.step)
        self.ax, self.ay = arnold(self.ax, self.ay, self.step)
        ch        = chebyshev_t(math.cos(self.step * 0.1), 3)
        raw       = w*0.5 + (self.ax+self.ay)/2*0.3 + (ch+1)/2*0.2
        return {
            'step':         self.step,
            'weyl':         round(w, 4),
            'arnold':       [round(self.ax, 4), round(self.ay, 4)],
            'chebyshev':    round(ch, 4),
            'reticleAngle': round(raw * 360, 2),
            'matrixEnergy': round(0.3 + 0.2*math.sin(self.step*0.07), 4),
        }

# ── Singletons ────────────────────────────────────────────────────────────────
cortex = Cortex()
engine = Engine()

# ── Logging ───────────────────────────────────────────────────────────────────
log_lock = threading.Lock()

def log_entry(action, inp, out, angle, ms):
    entry = {
        'ts':     datetime.now(timezone.utc).isoformat(),
        'source': 'python',
        'action': action,
        'input':  inp[:200] if inp else '',
        'output': out[:200] if out else '',
        'angle':  round(angle, 2),
        'thermal':cortex.status()['thermalBand']['label'],
        'ms':     ms,
    }
    with log_lock:
        with open(LOG_FILE, 'a') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    return entry

# ── Ollama ────────────────────────────────────────────────────────────────────
def ollama_generate(prompt, params):
    if OFFLINE:
        return f'[OFFLINE] Python AGY echo: {prompt[:80]}'
    payload = json.dumps({
        'model':  'llama3',
        'prompt': prompt,
        'stream': False,
        'options': {
            'num_ctx':     params.get('num_ctx', 2048),
            'num_predict': params.get('num_predict', 256),
            'temperature': 0.7,
        }
    }).encode()
    req = urllib.request.Request(
        f'{OLLAMA_URL}/api/generate',
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
        return data.get('response', '')

# ── TTS: Microsoft Szabolcs hang ─────────────────────────────────────────────
# Windows SAPI / Azure TTS (böngésző SpeechSynthesis-en keresztül)
# A Python AGY /tts végponton SSML-t ad vissza, amit a böngésző Web Speech API-ja olvas fel.
def make_ssml(text, lang='hu-HU', voice='hu-HU-SzabolcsNeural'):
    """
    Azure Cognitive Services Neural TTS – Szabolcs hang
    Ha a böngésző SpeechSynthesis nem támogat Szabolcs-ot, visszaesik a rendszer hu hangjára.
    """
    import xml.etree.ElementTree as ET
    speak = ET.Element('speak', {
        'version': '1.0',
        'xmlns': 'http://www.w3.org/2001/10/synthesis',
        'xml:lang': lang
    })
    voice_el = ET.SubElement(speak, 'voice', {'name': voice})
    voice_el.text = text
    return ET.tostring(speak, encoding='unicode', xml_declaration=False)

# ── HTTP Handler ──────────────────────────────────────────────────────────────
class AGYHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress default HTTP logging

    def send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text, ct='text/plain; charset=utf-8', code=200):
        body = text.encode()
        self.send_response(code)
        self.send_header('Content-Type', ct)
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length)) if length > 0 else {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]

        if path == '/status':
            st = cortex.status()
            st.update(engine.tick())
            self.send_json(st)

        elif path == '/log':
            try:
                with open(LOG_FILE) as f:
                    lines = f.readlines()
                entries = [json.loads(l) for l in lines[-50:] if l.strip()]
                self.send_json({'entries': entries, 'total': len(lines)})
            except FileNotFoundError:
                self.send_json({'entries': [], 'total': 0})

        elif path == '/':
            self.send_text(STATUS_HTML, 'text/html; charset=utf-8')

        elif path == '/tts-voices':
            # Visszaadja az elérhető Szabolcs-kompatibilis hanglistát
            self.send_json({
                'recommended': 'hu-HU-SzabolcsNeural',
                'fallbacks': ['hu-HU-NoemiNeural', 'hu'],
                'ssml_template': make_ssml('Szabolcs teszt'),
                'note': 'A böngésző Web Speech API-ja olvassa fel, SSML-t az /tts végpont ad vissza'
            })

        else:
            self.send_json({'error': 'Not found'}, 404)

    def do_POST(self):
        path = self.path.split('?')[0]

        if path == '/translate':
            body    = self.read_body()
            text    = body.get('text', '')
            lang    = body.get('targetLang', 'angol')
            t0      = time.time()
            params  = cortex.throttle()
            cortex.acquire(0.35)

            if params['delay_ms'] > 0:
                time.sleep(params['delay_ms'] / 1000)

            eng     = engine.tick()
            prompt  = (
                f'Fordítsd le {lang} nyelvre. '
                f'[Python AGY · ⊕{eng["reticleAngle"]}° · lépés:{eng["step"]}]\n\n{text}'
            )
            try:
                result = ollama_generate(prompt, params)
            except Exception as e:
                result = f'[Hiba] {e}'
            finally:
                cortex.release(0.35)

            ms   = int((time.time() - t0) * 1000)
            entry = log_entry('translate', text, result, eng['reticleAngle'], ms)
            self.send_json({
                'translation': result,
                'angle':       eng['reticleAngle'],
                'thermal':     params['band'],
                'ms':          ms,
                'log':         entry
            })

        elif path == '/tts':
            body = self.read_body()
            text = body.get('text', '')
            voice = body.get('voice', 'hu-HU-SzabolcsNeural')
            ssml = make_ssml(text, voice=voice)
            self.send_text(ssml, 'application/ssml+xml')

        else:
            self.send_json({'error': 'Not found'}, 404)

# ── Status HTML ───────────────────────────────────────────────────────────────
STATUS_HTML = """<!DOCTYPE html>
<html lang="hu"><head><meta charset="UTF-8">
<title>Python AGY :3001</title>
<style>
  body{background:#000a1e;color:#90b8d8;font:12px 'Courier New',monospace;padding:20px}
  h1{color:#8be28b;font-size:15px;letter-spacing:2px;margin-bottom:16px}
  .pill{background:rgba(0,20,60,.6);border:1px solid rgba(100,200,150,.2);
    border-radius:3px;padding:4px 10px;display:inline-block;margin:4px;color:#8be28b}
  a{color:#78c4ff}
</style>
</head><body>
<h1>⬡ PYTHON AGY · port 3001</h1>
<div class="pill">GET /status</div>
<div class="pill">POST /translate</div>
<div class="pill">POST /tts  (SSML)</div>
<div class="pill">GET /log</div>
<div class="pill">GET /tts-voices</div>
<p style="margin-top:16px;color:#506070">
  Napló: <code>/tmp/agy_log.jsonl</code> (közös Java AGY-val)<br>
  Hang: <a href="/tts-voices">Szabolcs Neural TTS</a>
</p>
<script>
  fetch('/status').then(r=>r.json()).then(d=>{
    document.body.innerHTML += '<pre style="color:#78c4ff;margin-top:16px">'+JSON.stringify(d,null,2)+'</pre>';
  });
</script>
</body></html>"""

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    server = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), AGYHandler)
    mode   = 'OFFLINE' if OFFLINE else f'Ollama: {OLLAMA_URL}'
    print(f'Python AGY  http://localhost:{PORT}  [{mode}]')
    print(f'Napló: {LOG_FILE}')
    print(f'TTS: Szabolcs Neural (hu-HU-SzabolcsNeural)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nLeállítva.')
