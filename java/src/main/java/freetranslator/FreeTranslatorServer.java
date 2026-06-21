package freetranslator;

import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/**
 * FreeTranslator v2.1 – Java HTTP szerver
 *
 * Beépített com.sun.net.httpserver (JDK 8+, 0 külső függőség).
 * Portja a Node.js ollama/server.js végpontjait Java-ban.
 *
 * Indítás:
 *   javac -d out src/main/java/freetranslator/*.java
 *   java -cp out freetranslator.FreeTranslatorServer
 *
 * Végpontok:
 *   GET  /api/health    – Ollama állapot
 *   GET  /api/models    – modellek listája
 *   POST /api/translate – SSE: fordítás streaming
 *   POST /api/interpret – SSE: AGY értelmezés
 *   POST /api/decide    – döntési mátrix (JSON)
 *   GET  /api/weights   – súly tábla (JSON)
 *   GET  /api/cortex    – Cortex ütemező állapot
 */
public class FreeTranslatorServer {

    private final int             port;
    private final OllamaClient    ollama;
    private final DecisionMatrix  matrix;
    private final CortexScheduler cortex;

    public FreeTranslatorServer(int port) {
        this.port   = port;
        this.ollama = new OllamaClient();
        this.matrix = new DecisionMatrix();
        this.cortex = new CortexScheduler();
    }

    public void start() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 64);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor()); // Java 21+

        server.createContext("/api/health",    this::handleHealth);
        server.createContext("/api/models",    this::handleModels);
        server.createContext("/api/translate", this::handleTranslate);
        server.createContext("/api/interpret", this::handleInterpret);
        server.createContext("/api/decide",    this::handleDecide);
        server.createContext("/api/weights",   this::handleWeights);
        server.createContext("/api/cortex",    this::handleCortex);
        server.createContext("/", this::handleStatic);

        server.start();
        System.out.printf("%nFreeTranslator v2.1 – Java backend%n");
        System.out.printf("Szerver: http://localhost:%d%n", port);
        System.out.printf("Ollama:  %s%n", System.getenv().getOrDefault("OLLAMA_HOST", "http://localhost:11434"));
        if (ollama.checkHealth()) {
            System.out.println("Ollama OK");
        } else {
            System.out.println("Figyelmeztetés: Ollama nem elérhető");
        }
    }

    // ── GET /api/health ───────────────────────────────────────────────────────

    private void handleHealth(HttpExchange ex) throws IOException {
        if (!"GET".equals(ex.getRequestMethod())) { send405(ex); return; }
        boolean ok = ollama.checkHealth();
        int models = 0;
        String largest = null;
        if (ok) {
            try {
                var list = ollama.listModels();
                models  = list.size();
                largest = list.isEmpty() ? null : list.get(0).name();
            } catch (Exception e) { /* ignore */ }
        }
        String json = String.format(
            "{\"ok\":%b,\"modelCount\":%d,\"largest\":%s}",
            ok, models, largest == null ? "null" : "\"" + largest + "\""
        );
        sendJson(ex, ok ? 200 : 503, json);
    }

    // ── GET /api/models ───────────────────────────────────────────────────────

    private void handleModels(HttpExchange ex) throws IOException {
        if (!"GET".equals(ex.getRequestMethod())) { send405(ex); return; }
        try {
            var list = ollama.listModels();
            var sb   = new StringBuilder("[");
            for (int i = 0; i < list.size(); i++) {
                if (i > 0) sb.append(",");
                sb.append(String.format("{\"name\":\"%s\",\"size\":%d}", list.get(i).name(), list.get(i).size()));
            }
            sb.append("]");
            String largest = list.isEmpty() ? "null" : "\"" + list.get(0).name() + "\"";
            sendJson(ex, 200, "{\"models\":" + sb + ",\"largest\":" + largest + "}");
        } catch (Exception e) {
            sendJson(ex, 503, "{\"error\":\"" + escJson(e.getMessage()) + "\"}");
        }
    }

    // ── POST /api/translate (SSE) ─────────────────────────────────────────────

    private void handleTranslate(HttpExchange ex) throws IOException {
        if (!"POST".equals(ex.getRequestMethod())) { send405(ex); return; }
        Map<String, Object> body = parseBody(ex);

        String text    = str(body, "text", "");
        String from    = str(body, "from", "hu");
        String to      = str(body, "to",   "en");
        String reqModel = str(body, "model", null);
        double reticle = num(body, "reticleAngle", -1);

        setupSSE(ex);
        long t0  = System.currentTimeMillis();
        var unit = cortex.allocate("east", 0.65, reticle < 0 ? null : reticle);

        try {
            String model  = (reqModel != null && !reqModel.isBlank()) ? reqModel : ollama.detectLargestModel();
            int    numCtx = OllamaClient.estimateContextWindow(model);
            var throttled = cortex.throttleParams(numCtx, 512, 0.3);

            if (throttled.delayMs() > 0) Thread.sleep(throttled.delayMs());

            String prompt = String.format(
                "Fordítsd le a következő szöveget %s nyelvről %s nyelvre.\n" +
                "Csak a fordítást add vissza, semmilyen magyarázat nélkül.\n" +
                "Szöveg: \"%s\"\nFordítás:", from, to, text
            );

            var opts = new OllamaClient.GenerateOptions(throttled.numCtx(), throttled.numPredict(), throttled.temperature());
            var sb   = new StringBuilder();

            ollama.streamGenerate(model, prompt, opts, (token, done) -> {
                try {
                    if (!token.isEmpty()) {
                        sb.append(token);
                        sseEvent(ex, "{\"token\":\"" + escJson(token) + "\"}");
                    }
                    if (done) {
                        cortex.release(unit.id, 0.65, System.currentTimeMillis() - t0);
                        sseEvent(ex, String.format(
                            "{\"done\":true,\"fullText\":\"%s\",\"model\":\"%s\",\"cortex\":{\"band\":\"%s\",\"thermalPct\":%d}}",
                            escJson(sb.toString().trim()), escJson(model),
                            throttled.band().name(), cortex.getThermalPct()
                        ));
                        ex.getResponseBody().close();
                    }
                } catch (IOException ignore) {}
            });

        } catch (Exception e) {
            cortex.release(unit.id, 0.65, System.currentTimeMillis() - t0);
            try { sseEvent(ex, "{\"error\":\"" + escJson(e.getMessage()) + "\"}"); ex.getResponseBody().close(); }
            catch (IOException ignore) {}
        }
    }

    // ── POST /api/interpret (SSE) ─────────────────────────────────────────────

    private void handleInterpret(HttpExchange ex) throws IOException {
        if (!"POST".equals(ex.getRequestMethod())) { send405(ex); return; }
        Map<String, Object> body = parseBody(ex);

        String engineType    = str(body, "engineType", "weyl");
        int    step          = (int) num(body, "step", 0);
        double matrixEnergy  = num(body, "matrixEnergy", 50);
        double reticleAngle  = num(body, "reticleAngle", 0);
        String dominant      = str(body, "dominantDirection", "north");
        String reqModel      = str(body, "model", null);

        setupSSE(ex);
        long t0  = System.currentTimeMillis();
        var unit = cortex.allocate("north", 0.55, reticleAngle);

        try {
            String model  = (reqModel != null && !reqModel.isBlank()) ? reqModel : ollama.detectLargestModel();
            int    numCtx = OllamaClient.estimateContextWindow(model);
            var throttled = cortex.throttleParams(numCtx, 256, 0.4);

            if (throttled.delayMs() > 0) Thread.sleep(throttled.delayMs());

            String prompt = String.format(
                "Te a Szabályzó AGY (0-1 Roulette Explorer) értelmezője vagy.\n" +
                "Aktuális állapot:\n- Motor: %s, Lépés: %d, Energia: %.1f\n" +
                "- Irányzék szög: %.1f°\n- Domináns irány: %s\n" +
                "- Cortex hőmérséklet: %d%% (%s)\n\n" +
                "Adj egy tömör, 2-3 mondatos értelmezést: mit csinál most a rendszer?\n" +
                "Stílus: technikai, precíz, magyar nyelvű.",
                engineType, step, matrixEnergy, reticleAngle, dominant,
                cortex.getThermalPct(), cortex.getThermalBand().label
            );

            var opts = new OllamaClient.GenerateOptions(throttled.numCtx(), throttled.numPredict(), throttled.temperature());
            final String finalModel = model;

            ollama.streamGenerate(model, prompt, opts, (token, done) -> {
                try {
                    if (!token.isEmpty()) sseEvent(ex, "{\"token\":\"" + escJson(token) + "\"}");
                    if (done) {
                        cortex.release(unit.id, 0.55, System.currentTimeMillis() - t0);
                        sseEvent(ex, "{\"done\":true,\"model\":\"" + escJson(finalModel) + "\"}");
                        ex.getResponseBody().close();
                    }
                } catch (IOException ignore) {}
            });

        } catch (Exception e) {
            cortex.release(unit.id, 0.55, System.currentTimeMillis() - t0);
            try { sseEvent(ex, "{\"error\":\"" + escJson(e.getMessage()) + "\"}"); ex.getResponseBody().close(); }
            catch (IOException ignore) {}
        }
    }

    // ── POST /api/decide ─────────────────────────────────────────────────────

    private void handleDecide(HttpExchange ex) throws IOException {
        if (!"POST".equals(ex.getRequestMethod())) { send405(ex); return; }
        Map<String, Object> body = parseBody(ex);
        Map<String, Double> values = new HashMap<>();
        body.forEach((k, v) -> {
            if (v instanceof Number n) values.put(k, n.doubleValue());
        });
        try {
            var result = matrix.compute(values);
            sendJson(ex, 200, toJson(result));
        } catch (Exception e) {
            sendJson(ex, 500, "{\"error\":\"" + escJson(e.getMessage()) + "\"}");
        }
    }

    // ── GET /api/weights ──────────────────────────────────────────────────────

    private void handleWeights(HttpExchange ex) throws IOException {
        if (!"GET".equals(ex.getRequestMethod())) { send405(ex); return; }
        var weights = matrix.getAllWeights();
        var sb = new StringBuilder("{");
        weights.forEach((k, v) -> sb.append("\"").append(k).append("\":").append(v).append(","));
        if (sb.charAt(sb.length()-1) == ',') sb.setCharAt(sb.length()-1, '}');
        else sb.append("}");
        sendJson(ex, 200, sb.toString());
    }

    // ── GET /api/cortex ───────────────────────────────────────────────────────

    private void handleCortex(HttpExchange ex) throws IOException {
        if (!"GET".equals(ex.getRequestMethod())) { send405(ex); return; }
        sendJson(ex, 200, mapToJson(cortex.status()));
    }

    // ── Static file fallback ──────────────────────────────────────────────────

    private void handleStatic(HttpExchange ex) throws IOException {
        sendJson(ex, 200, "{\"name\":\"FreeTranslator v2.1 Java\",\"status\":\"ok\"}");
    }

    // ── HTTP segédek ─────────────────────────────────────────────────────────

    private void setupSSE(HttpExchange ex) throws IOException {
        ex.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-cache");
        ex.getResponseHeaders().set("Connection", "keep-alive");
        ex.sendResponseHeaders(200, 0);
    }

    private void sseEvent(HttpExchange ex, String json) throws IOException {
        byte[] data = ("data: " + json + "\n\n").getBytes(StandardCharsets.UTF_8);
        ex.getResponseBody().write(data);
        ex.getResponseBody().flush();
    }

    private void sendJson(HttpExchange ex, int code, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(code, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.getResponseBody().close();
    }

    private void send405(HttpExchange ex) throws IOException {
        sendJson(ex, 405, "{\"error\":\"Method not allowed\"}");
    }

    // ── Body / JSON segéd ─────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseBody(HttpExchange ex) throws IOException {
        String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        return parseJsonObject(body);
    }

    private String str(Map<String, Object> m, String k, String def) {
        Object v = m.get(k);
        return v != null ? v.toString() : def;
    }

    private double num(Map<String, Object> m, String k, double def) {
        Object v = m.get(k);
        if (v instanceof Number n) return n.doubleValue();
        if (v instanceof String s) try { return Double.parseDouble(s); } catch (NumberFormatException e) { /* fall */ }
        return def;
    }

    private Map<String, Object> parseJsonObject(String json) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (json == null || json.isBlank()) return map;
        json = json.trim();
        if (json.startsWith("{")) json = json.substring(1, json.lastIndexOf('}'));
        // Naív key-value parser (flat objects)
        int i = 0;
        while (i < json.length()) {
            int ks = json.indexOf('"', i); if (ks < 0) break;
            int ke = json.indexOf('"', ks + 1); if (ke < 0) break;
            String key = json.substring(ks + 1, ke);
            int colon  = json.indexOf(':', ke + 1); if (colon < 0) break;
            int vs     = colon + 1;
            while (vs < json.length() && json.charAt(vs) == ' ') vs++;
            if (vs >= json.length()) break;
            char first = json.charAt(vs);
            if (first == '"') {
                int ve = vs + 1;
                while (ve < json.length() && (json.charAt(ve) != '"' || json.charAt(ve-1) == '\\')) ve++;
                map.put(key, json.substring(vs + 1, ve));
                i = ve + 1;
            } else {
                int ve = vs;
                while (ve < json.length() && ",}\n\r".indexOf(json.charAt(ve)) < 0) ve++;
                String val = json.substring(vs, ve).trim();
                if ("true".equals(val))  map.put(key, true);
                else if ("false".equals(val)) map.put(key, false);
                else if ("null".equals(val))  map.put(key, null);
                else try { map.put(key, Double.parseDouble(val)); } catch (NumberFormatException e) { map.put(key, val); }
                i = ve + 1;
            }
        }
        return map;
    }

    private String escJson(String s) {
        if (s == null) return "";
        return s.replace("\\","\\\\").replace("\"","\\\"")
                .replace("\n","\\n").replace("\r","\\r").replace("\t","\\t");
    }

    @SuppressWarnings("unchecked")
    private String mapToJson(Map<String, Object> m) {
        var sb = new StringBuilder("{");
        m.forEach((k, v) -> {
            if (sb.length() > 1) sb.append(",");
            sb.append("\"").append(k).append("\":");
            sb.append(valueToJson(v));
        });
        sb.append("}");
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private String valueToJson(Object v) {
        if (v == null)                return "null";
        if (v instanceof Boolean b)   return b.toString();
        if (v instanceof Number n)    return n.toString();
        if (v instanceof String s)    return "\"" + escJson(s) + "\"";
        if (v instanceof Map<?,?> m)  return mapToJson((Map<String, Object>) m);
        if (v instanceof List<?> l)   {
            var sb = new StringBuilder("[");
            l.forEach(e -> { if (sb.length() > 1) sb.append(","); sb.append(valueToJson(e)); });
            return sb.append("]").toString();
        }
        return "\"" + escJson(v.toString()) + "\"";
    }

    private String toJson(DecisionMatrix.DecisionResult r) {
        return String.format(
            "{\"timestamp\":%d,\"inner\":{\"score\":%.6f,\"angleOut\":%.2f,\"dominant\":\"%s\",\"confidence\":%.4f}," +
            "\"outer\":{\"dominant\":\"%s\",\"dominantScore\":%.4f,\"distribution\":%s}," +
            "\"comparison\":{\"agree\":%b,\"resonance\":%.4f,\"anomaly\":%b,\"verdict\":\"%s\"}}",
            r.timestamp(),
            r.inner().score(), r.inner().angleOut(), r.inner().dominant(), r.inner().confidence(),
            r.outer().dominant(), r.outer().dominantScore(), mapToJson(new LinkedHashMap<>(r.outer().distribution())),
            r.comparison().agree(), r.comparison().resonance(), r.comparison().anomaly(),
            escJson(r.comparison().verdict())
        );
    }

    // ── Main ─────────────────────────────────────────────────────────────────

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "3001"));
        new FreeTranslatorServer(port).start();
    }
}
