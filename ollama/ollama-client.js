/**
 * Ollama API kliens
 * - Auto-detektálja a legnagyobb elérhető modellt
 * - Streaming token-by-token és batch módban
 * - Kontextus-sűrítés: maximális num_ctx kihasználás
 */

const OLLAMA_BASE = process.env.OLLAMA_HOST || 'http://localhost:11434';

async function listModels() {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`);
  if (!res.ok) throw new Error(`Ollama nem elérhető (${OLLAMA_BASE}): HTTP ${res.status}`);
  const data = await res.json();
  return (data.models || []).sort((a, b) => (b.size || 0) - (a.size || 0));
}

async function detectLargestModel() {
  const models = await listModels();
  if (!models.length) throw new Error('Nincs letöltött Ollama modell. Futtasd: ollama pull <modell>');
  return models[0].name;
}

/**
 * Streaming generálás – async generator, yielddel adja a tokeneket.
 * @yields {{ response: string, done: boolean, eval_count?: number }}
 */
async function* streamGenerate(model, prompt, options = {}) {
  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: true, ...options })
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Ollama generate hiba ${res.status}: ${err}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        yield parsed;
        if (parsed.done) return;
      } catch { /* skip malformed */ }
    }
  }
}

async function generate(model, prompt, options = {}) {
  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, ...options })
  });
  if (!res.ok) throw new Error(`Ollama generate hiba: ${res.status}`);
  return res.json();
}

async function checkHealth() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = data.models || [];
    return { ok: true, modelCount: models.length, base: OLLAMA_BASE };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Modell kapacitás becslése: context window ajánlás a modell neve alapján.
 * Sűrűség-kiaknázás: minél nagyobb a modell, annál nagyobb ablakot használunk.
 */
function estimateContextWindow(modelName) {
  const name = (modelName || '').toLowerCase();
  if (name.includes('70b') || name.includes('72b') || name.includes('65b')) return 8192;
  if (name.includes('34b') || name.includes('32b') || name.includes('30b')) return 8192;
  if (name.includes('13b') || name.includes('14b') || name.includes('15b')) return 6144;
  if (name.includes('7b') || name.includes('8b'))  return 4096;
  if (name.includes('3b') || name.includes('3.8b')) return 4096;
  if (name.includes('1b') || name.includes('1.5b')) return 2048;
  return 4096;
}

module.exports = { listModels, detectLargestModel, streamGenerate, generate, checkHealth, estimateContextWindow, OLLAMA_BASE };
