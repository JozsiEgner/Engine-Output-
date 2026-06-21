# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FreeTranslator v2.1 with 0-Roulette AGY (Artificial General Brain)** — an experimental AI routing framework that combines local LLM integration (via Ollama) with a deterministic direction-routing system built on mathematical primitives. The system is implemented in three languages: JavaScript (primary), Python (port, port 3001), and Java (port, port 3002).

## Running the Project

**Prerequisites:** Ollama daemon running locally (`ollama serve`) with at least one model pulled.

```bash
# Install dependencies
npm install

# Start the Node.js server (port 3000)
npm start

# Development mode (auto-restart on file changes)
npm run dev

# Start Python AGY (port 3001)
python3 python/agy.py

# Build and run Java AGY (port 3002, requires Java 21+)
bash java/build.sh
```

**Environment variables:**
- `OFFLINE=1` — disable Ollama and run decision-matrix logic only
- `PORT` — override default port 3000
- `OLLAMA_HOST` — override default `http://localhost:11434`

After starting, open `http://localhost:3000/freetranslator-v2.1.html` in a browser.

## Architecture

The system has three layers:

### 1. Express Server (`ollama/`)
- `ollama/server.js` — main entry point; mounts all REST and SSE endpoints, instantiates all core modules
- `ollama/ollama-client.js` — thin wrapper around the Ollama HTTP API; handles model auto-selection, streaming, context-window estimation, and health checks

### 2. Core Decision & Routing Engine (`src/`)

All modules export singleton instances or pure functions used by `server.js`.

| Module | Role |
|---|---|
| `math-engine.js` | Deterministic angle computation via Weyl (golden ratio), Arnold (cat map), and Chebyshev polynomial engines; balloon radius and cardinal force distribution |
| `decision-matrix.js` | Dual-layer atom model — inner layer produces a single scalar decision, outer layer distributes force across N/E/S/W; 16 tracked variables; adaptive weight deltas |
| `cortex-scheduler.js` | GPU warp/block/SM analogy; tracks load and heat per `CortexUnit`; four thermal bands (COOL/WARM/HOT/CRITICAL) that scale context windows and prediction multipliers |
| `dark-silicon-doctor.js` | Monitors overheated units; maintains a shadow registry of standby cool units; issues prescriptions (COOL/SHADOW/HIBERNATE/WAKE); runs diagnostics every 3 s |
| `function-slice.js` | Direction-mapped cognitive domains (North=question/analysis, East=translation/action, South=decision/synthesis, West=learning/context); shadow slices back up dark primaries |
| `atom-lego.js` | 4 KB "brick" content units with LZ-style compression and QR references for internet-addressable deferred content |
| `structural-columns.js` | 4 pillars × 21 resonance levels; maps directions to visible-light wavelengths; applies anti-deformation constraints that grow non-linearly under load |
| `qr-entry.js` | Maps semantic directions to API routes using QR V1 (21×21) geometry; computes distance pairs and organisation scores |
| `multi-channel.js` | Dual-frequency encoding using light wavelengths (visible spectrum) and sound resonance (20 Hz–20 kHz) |
| `angle-system.js` | Canonical 0°/90°/180°/270° direction definitions and normalisation helpers |
| `endpoint-map.js` | Keyword-based heuristic routing to the four cardinal AI roles |

### 3. Frontend (`*.html`)
- `freetranslator-v2.1.html` — production UI with streaming SSE translation, AGY interpretation, and decision-matrix visualization
- `index.html` — interactive 0-Roulette sphere visualization with live sliders
- `freetranslator-panorama.html` — panoramic display variant

## Key Concepts

**Cardinal directions** represent cognitive domains throughout the entire codebase — every module uses North/East/South/West (or 0°/90°/180°/270°) as the primary routing abstraction. When modifying routing logic, maintain this four-direction symmetry.

**Thermal bands** (COOL → WARM → HOT → CRITICAL) gate resource allocation in `cortex-scheduler.js` and `function-slice.js`. Units exceeding CRITICAL heat are handed to the dark-silicon doctor, which promotes a shadow unit from the registry. Any new processing unit type must integrate with both systems.

**Adaptive weight loop:** After each successful operation, `decision-matrix.js` increments the directional weight (north/east/south/west delta). This state is in-memory and resets on server restart — there is no persistence layer.

**Offline mode:** When `OFFLINE=1`, all Ollama calls are bypassed. The routing and decision-matrix logic still runs fully. This is useful for testing the mathematical core without a running Ollama instance.

**Python and Java ports** are feature-equivalent to the Node.js implementation but independent processes (ports 3001 and 3002). They are not called by the Node server — they run as standalone alternatives. Changes to core algorithms should be mirrored across all three.

## API Endpoints (port 3000)

| Endpoint | Transport | Description |
|---|---|---|
| `GET /api/health` | JSON | Ollama connectivity check |
| `GET /api/models` | JSON | Available Ollama models |
| `POST /api/translate` | SSE | Streaming LLM translation + AGY output |
| `POST /api/interpret` | SSE | AGY brain interpretation only |
| `POST /api/route` | JSON | Semantic routing via decision matrix |
| `POST /api/decide` | JSON | Dual-layer decision result |
| `GET /api/weights` | JSON | Current adaptive weight state |
| `POST /api/qr` | JSON | QR code generation |
| `GET /api/distance` | JSON | Distance pair metrics |
| `GET /api/cortex` | JSON | Thermal scheduler state |
| `GET /api/doctor` | JSON | Dark silicon diagnostics |
| `GET /api/slices` | JSON | Function slice status |
