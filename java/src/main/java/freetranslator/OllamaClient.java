package freetranslator;

import java.io.*;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.stream.*;
import java.util.function.*;

/**
 * FreeTranslator v2.1 – Ollama HTTP kliens (Java port)
 *
 * Endpoints:
 *   GET  /api/tags      – modellek listája (méret szerint csökkenő)
 *   POST /api/generate  – szöveg generálás (streaming és szinkron)
 *   GET  /              – health check
 *
 * Streaming: Java 11+ HttpClient + InputStream sor-olvasó
 * JSON: beépített JSON parse (nincs külső függőség)
 */
public class OllamaClient {

    private final String  baseUrl;
    private final HttpClient http;

    public OllamaClient() {
        this(System.getenv().getOrDefault("OLLAMA_HOST", "http://localhost:11434"));
    }

    public OllamaClient(String baseUrl) {
        this.baseUrl = baseUrl.replaceAll("/$", "");
        this.http    = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    }

    // ── Modellek ─────────────────────────────────────────────────────────────

    public record ModelInfo(String name, long size) {}

    /** Modellek listája méret szerint csökkenő sorrendben */
    public List<ModelInfo> listModels() throws IOException, InterruptedException {
        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + "/api/tags"))
            .GET().timeout(Duration.ofSeconds(5))
            .build();
        HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
        return parseModels(resp.body());
    }

    public String detectLargestModel() throws IOException, InterruptedException {
        List<ModelInfo> models = listModels();
        if (models.isEmpty()) throw new IllegalStateException("Nincs letöltött Ollama modell");
        return models.get(0).name();
    }

    /** Kontextusablak becslés modell névből */
    public static int estimateContextWindow(String modelName) {
        String n = modelName.toLowerCase();
        if (n.contains("70b") || n.contains("65b") || n.contains("72b")) return 8192;
        if (n.contains("34b") || n.contains("33b") || n.contains("30b") || n.contains("13b")) return 6144;
        if (n.contains("7b")  || n.contains("8b")  || n.contains("9b"))  return 4096;
        return 2048;
    }

    // ── Health ────────────────────────────────────────────────────────────────

    public boolean checkHealth() {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/"))
                .GET().timeout(Duration.ofSeconds(3))
                .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            return resp.statusCode() == 200;
        } catch (Exception e) {
            return false;
        }
    }

    // ── Szinkron generálás ────────────────────────────────────────────────────

    public record GenerateOptions(int numCtx, int numPredict, double temperature) {}

    public String generate(String model, String prompt, GenerateOptions opts)
            throws IOException, InterruptedException {
        String body = buildBody(model, prompt, opts, false);
        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + "/api/generate"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .timeout(Duration.ofSeconds(60))
            .build();
        HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
        return extractField(resp.body(), "response");
    }

    // ── Streaming generálás ───────────────────────────────────────────────────

    /**
     * Token-folyam: callback minden tokenre hívódik.
     * @param onToken  (token, isDone) → void
     */
    public void streamGenerate(String model, String prompt, GenerateOptions opts,
                               BiConsumer<String, Boolean> onToken)
            throws IOException, InterruptedException {
        String body = buildBody(model, prompt, opts, true);
        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + "/api/generate"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .timeout(Duration.ofSeconds(120))
            .build();

        HttpResponse<InputStream> resp = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(resp.body(), java.nio.charset.StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isBlank()) continue;
                String token = extractField(line, "response");
                boolean done = "true".equals(extractField(line, "done"));
                if (!token.isEmpty()) onToken.accept(token, false);
                if (done) { onToken.accept("", true); break; }
            }
        }
    }

    // ── JSON segéd (külső könyvtár nélkül) ───────────────────────────────────

    private List<ModelInfo> parseModels(String json) {
        List<ModelInfo> result = new ArrayList<>();
        int modelsStart = json.indexOf("\"models\"");
        if (modelsStart < 0) return result;

        // Egyszerű regex-mentes parser: name + size párok
        int pos = modelsStart;
        while (true) {
            int nameIdx = json.indexOf("\"name\"", pos);
            if (nameIdx < 0) break;
            int nameStart = json.indexOf("\"", nameIdx + 7) + 1;
            int nameEnd   = json.indexOf("\"", nameStart);
            String name   = json.substring(nameStart, nameEnd);

            int sizeIdx = json.indexOf("\"size\"", nameEnd);
            if (sizeIdx < 0) break;
            int numStart = sizeIdx + 7;
            while (numStart < json.length() && !Character.isDigit(json.charAt(numStart))) numStart++;
            int numEnd = numStart;
            while (numEnd < json.length() && (Character.isDigit(json.charAt(numEnd)) || json.charAt(numEnd) == '.')) numEnd++;
            long size = 0;
            try { size = Long.parseLong(json.substring(numStart, numEnd)); } catch (NumberFormatException e) { /* skip */ }

            result.add(new ModelInfo(name, size));
            pos = numEnd;
        }

        result.sort(Comparator.comparingLong(ModelInfo::size).reversed());
        return result;
    }

    private String extractField(String json, String field) {
        String key = "\"" + field + "\"";
        int idx = json.indexOf(key);
        if (idx < 0) return "";
        int colon = json.indexOf(":", idx + key.length());
        if (colon < 0) return "";
        int valStart = colon + 1;
        while (valStart < json.length() && json.charAt(valStart) == ' ') valStart++;
        if (valStart >= json.length()) return "";
        char first = json.charAt(valStart);
        if (first == '"') {
            // string érték
            StringBuilder sb = new StringBuilder();
            int i = valStart + 1;
            while (i < json.length() && json.charAt(i) != '"') {
                if (json.charAt(i) == '\\' && i + 1 < json.length()) {
                    i++;
                    switch (json.charAt(i)) {
                        case 'n': sb.append('\n'); break;
                        case 't': sb.append('\t'); break;
                        case 'r': sb.append('\r'); break;
                        default:  sb.append(json.charAt(i));
                    }
                } else sb.append(json.charAt(i));
                i++;
            }
            return sb.toString();
        } else {
            // szám vagy boolean
            int end = valStart;
            while (end < json.length() && ",}]\n\r ".indexOf(json.charAt(end)) < 0) end++;
            return json.substring(valStart, end).trim();
        }
    }

    private String buildBody(String model, String prompt, GenerateOptions opts, boolean stream) {
        return String.format(
            "{\"model\":\"%s\",\"prompt\":\"%s\",\"stream\":%b,\"options\":{\"temperature\":%.2f,\"num_predict\":%d,\"num_ctx\":%d}}",
            escJson(model), escJson(prompt), stream,
            opts.temperature(), opts.numPredict(), opts.numCtx()
        );
    }

    private String escJson(String s) {
        return s.replace("\\","\\\\").replace("\"","\\\"")
                .replace("\n","\\n").replace("\r","\\r").replace("\t","\\t");
    }
}
