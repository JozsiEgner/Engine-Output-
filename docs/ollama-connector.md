# Ollama → FreeTranslator v2.1 Csatlakozó

## Áttekintés

A rendszer három réteget integrál:

1. **0-Roulette AGY** – determinisztikus irányrouting (Weyl/Arnold/Chebyshev motor)
2. **Ollama helyi AI** – a legnagyobb elérhető modell automatikus detektálása
3. **FreeTranslator v2.1 UI** – streaming fordítás, AGY értelmező, rezgés-vizualizáció

---

## Indítás

```bash
# 1. Ollama elindítása (ha még nem fut)
ollama serve

# 2. Modell letöltése (a lehető legnagyobb, amit a gép elbír)
ollama pull llama3:70b    # ~40GB VRAM
ollama pull llama3:8b     # ~5GB RAM (CPU-n is fut)
ollama pull mistral       # ~4GB RAM

# 3. Szerver indítása
npm install
npm start

# 4. Böngésző
open http://localhost:3000/freetranslator-v2.1.html
```

---

## API végpontok

| Végpont            | Módszer | Leírás                                       |
|--------------------|---------|----------------------------------------------|
| `/api/health`      | GET     | Ollama állapot + modellszám                  |
| `/api/models`      | GET     | Elérhető modellek listája (méret szerint)    |
| `/api/translate`   | POST    | SSE streaming fordítás                       |
| `/api/interpret`   | POST    | SSE streaming AGY értelmezés                 |
| `/api/route`       | POST    | Szemantikai irányrouting (JSON)              |

---

## Tartály sűrűség

Az Ollama modell kontextusablakát a modell mérete szerint automatikusan maximalizálja:

| Modell méret | Kontextus (num_ctx) |
|-------------|---------------------|
| 70B+        | 8192 token          |
| 13-34B      | 6144 token          |
| 7-8B        | 4096 token          |
| 1-3B        | 2048 token          |

A fordítási kontextus (előző 4 fordítás) mindig bele van csomagolva a promptba.

---

## Kettős frekvencia skála

- **Fény** (c = 3×10⁸ m/s): irányok hullámhossz-alapú kódolása (nm)
  - Észak: ~450nm (kék) – kérdések
  - Kelet: ~530nm (zöld) – fordítás
  - Dél: ~680nm (vörös) – döntés
  - Nyugat: ~405nm (ibolya) – tanulás

- **Hang** (v = 343 m/s): mutató rezgési frekvencia
  - f = v / (2 × ívhossz)
  - ívhossz = kar_hossz × Δszög_rad
  - Audiosávban: 20 Hz – 20 kHz

---

## Burok dinamika

Három mód:

| Mód       | Leírás                                              |
|-----------|-----------------------------------------------------|
| Statikus  | Rögzített alapátmérő (0.48)                        |
| Dinamikus | Szinuszos oszcilláció (0.32–0.52, lépésfüggő)     |
| Aberrált  | Szögfüggő sávos tágulás (0.28–0.58, korlátlan)    |

---

## Önstruktúra fejlesztés

A rendszer figyeli a routing mintákat és adaptálja a súlyokat:
- Minden sikeres fordítás után a Kelet (fordítás) irány súlya enyhén nő
- Maximum 20 fordítást tárol kontextusként
- `routingWeightAdapt` objektum minden lépéssel finomodik
