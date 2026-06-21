package freetranslator;

import java.util.*;
import java.util.stream.*;
import java.util.function.*;

/**
 * FreeTranslator v2.1 – Kettős Réteg Döntési Mátrix (Java port)
 *
 * BELSŐ réteg (fusion/mag):
 *   Minden változó normalizált × súly → összeg → szög → domináns irány
 *
 * KÜLSŐ réteg (decay/héj):
 *   Minden változó affinitással sugározza energiáját a 4 végpont felé
 *
 * Összehasonlítás: rezonancia / divergencia mérték
 */
public class DecisionMatrix {

    public static final List<String> DIRS = List.of("north", "east", "south", "west");
    private static final Map<String, Integer> DIR_ANGLES = Map.of(
        "north", 0, "east", 90, "south", 180, "west", 270
    );

    // ── Változó katalógus ────────────────────────────────────────────────────

    public record Variable(
        String id, String label, String layer, double w0,
        ToDoubleFunction<Double> norm,
        Function<Double, Map<String, Double>> affinity
    ) {}

    private static Map<String, Double> dir4(double n, double e, double s, double w) {
        return Map.of("north", n, "east", e, "south", s, "west", w);
    }

    public static final List<Variable> CATALOG = List.of(
        new Variable("reticleAngle", "Irányzék szög (°)", "both", 0.85,
            v -> v / 360.0,
            v -> { double r = Math.toRadians(v);
                   return dir4(Math.max(0,Math.cos(r)), Math.max(0,Math.cos(r-Math.PI/2)),
                               Math.max(0,Math.cos(r-Math.PI)), Math.max(0,Math.cos(r-3*Math.PI/2))); }),
        new Variable("north", "Észak %", "outer", 0.72,
            v -> v / 100.0,
            v -> dir4(v/100.0, 0.05, 0.05, 0.05)),
        new Variable("east", "Kelet %", "outer", 0.91,
            v -> v / 100.0,
            v -> dir4(0.05, v/100.0, 0.05, 0.05)),
        new Variable("south", "Dél %", "outer", 0.54,
            v -> v / 100.0,
            v -> dir4(0.05, 0.05, v/100.0, 0.05)),
        new Variable("west", "Nyugat %", "outer", 0.31,
            v -> v / 100.0,
            v -> dir4(0.05, 0.05, 0.05, v/100.0)),
        new Variable("matrixEnergy", "Mátrix energia", "inner", 0.78,
            v -> v / 100.0,
            v -> { double en = v/100.0;
                   return dir4(en*0.5, en*0.4, (1-en)*0.4, (1-en)*0.2); }),
        new Variable("tension", "Feszültség", "inner", 0.65,
            v -> v,
            v -> dir4(0.1, 0.1, v*0.7, (1-v)*0.5)),
        new Variable("resonance", "Rezonancia", "inner", 0.45,
            v -> v,
            v -> dir4(v*0.3, v*0.5, v*0.1, v*0.4)),
        new Variable("vibFreqHz", "Rezgés (Hz)", "both", 0.67,
            v -> Math.min(1, Math.log10(Math.max(1, v)) / 5.0),
            v -> { double f = Math.min(1, v/20000.0);
                   return dir4(f*0.6, f*0.3, (1-f)*0.5, (1-f)*0.3); }),
        new Variable("vibAmp", "Rezgés amp", "both", 0.42,
            v -> Math.min(1, v),
            v -> dir4(v*0.4, v*0.4, (1-v)*0.3, (1-v)*0.4)),
        new Variable("contextSize", "Kontextus méret", "both", 0.38,
            v -> Math.min(1, v/20.0),
            v -> { double c = Math.min(1, v/20.0);
                   return dir4(0.1, c*0.6, 0.05, c*0.8); }),
        new Variable("step", "Lépésszám", "both", 0.20,
            v -> Math.min(1, v/1000.0),
            v -> { double s = Math.min(1, v/1000.0);
                   return dir4(0.1, 0.1, s*0.3, s*0.6); })
    );

    // Súly tábla (tanulással módosítható)
    private final Map<String, Double> weights = new HashMap<>();

    public DecisionMatrix() {
        CATALOG.forEach(v -> weights.put(v.id(), v.w0()));
    }

    public double getWeight(String id) { return weights.getOrDefault(id, 0.5); }

    public void adaptWeight(String id, double delta) {
        weights.merge(id, delta, (old, d) -> Math.min(1, Math.max(0, old + d)));
    }

    public Map<String, Double> getAllWeights() { return Collections.unmodifiableMap(weights); }

    // ── Kiértékelt változó ───────────────────────────────────────────────────

    public record EvalVar(
        String id, String label, String layer,
        double raw, double normalized, double weight,
        Map<String, Double> affinity
    ) {}

    private EvalVar eval(Variable v, Map<String, Double> values) {
        double raw  = values.getOrDefault(v.id(), 0.0);
        double nv   = v.norm().applyAsDouble(raw);
        if (!Double.isFinite(nv)) nv = 0;
        return new EvalVar(v.id(), v.label(), v.layer(), raw, nv, getWeight(v.id()), v.affinity().apply(raw));
    }

    // ── BELSŐ RÉTEG – fusion ─────────────────────────────────────────────────

    public record InnerResult(
        double score, double angleOut, String dominant,
        double confidence, List<Map<String, Object>> contributions
    ) {}

    public InnerResult computeInner(List<EvalVar> vars) {
        double weightedSum = 0, totalWeight = 0;
        List<Map<String, Object>> contribs = new ArrayList<>();

        for (EvalVar ev : vars) {
            if ("outer".equals(ev.layer())) continue;
            double contrib = ev.normalized() * ev.weight();
            weightedSum += contrib;
            totalWeight += ev.weight();
            contribs.add(Map.of("id", ev.id(), "contrib", contrib, "weight", ev.weight()));
        }

        double score      = totalWeight > 0 ? weightedSum / totalWeight : 0;
        double angleOut   = score * 360.0;
        String dominant   = findDominant(angleOut);
        double confidence = Math.abs(score - 0.5) * 2.0;

        contribs.sort(Comparator.comparingDouble(m -> -((Double) m.get("contrib"))));
        return new InnerResult(round6(score), round2(angleOut), dominant, round4(confidence), contribs);
    }

    private String findDominant(double angleDeg) {
        double a = MathEngine.normalizeAngle(angleDeg);
        return DIRS.stream().min(Comparator.comparingDouble(d -> {
            double diff = Math.abs(a - DIR_ANGLES.get(d));
            return Math.min(diff, 360 - diff);
        })).orElse("north");
    }

    // ── KÜLSŐ RÉTEG – decay ──────────────────────────────────────────────────

    public record OuterResult(
        Map<String, Integer> distribution, String dominant,
        double dominantScore, Map<String, Double> rawScores
    ) {}

    public OuterResult computeOuter(List<EvalVar> vars) {
        Map<String, Double> scores  = new HashMap<>(Map.of("north",0d,"east",0d,"south",0d,"west",0d));

        for (EvalVar ev : vars) {
            if ("inner".equals(ev.layer())) continue;
            double totalAff = DIRS.stream().mapToDouble(d -> ev.affinity().getOrDefault(d, 0d)).sum();
            if (totalAff == 0) continue;
            for (String dir : DIRS) {
                double aff    = ev.affinity().getOrDefault(dir, 0d) / totalAff;
                double contrib = ev.normalized() * ev.weight() * aff;
                scores.merge(dir, contrib, Double::sum);
            }
        }

        double total = scores.values().stream().mapToDouble(v -> v).sum();
        Map<String, Integer> dist = new LinkedHashMap<>();
        DIRS.forEach(d -> dist.put(d, total > 0 ? (int) Math.round(scores.get(d) / total * 100) : 25));

        // Korrekció: összeg = 100
        String maxDir = DIRS.stream().max(Comparator.comparingInt(dist::get)).orElse("north");
        dist.put(maxDir, dist.get(maxDir) + 100 - dist.values().stream().mapToInt(i -> i).sum());

        String dominant    = DIRS.stream().max(Comparator.comparingInt(dist::get)).orElse("north");
        double domScore    = dist.get(dominant) / 100.0;

        return new OuterResult(dist, dominant, round4(domScore), Map.copyOf(scores));
    }

    // ── ÖSSZEHASONLÍTÁS ──────────────────────────────────────────────────────

    public record Comparison(
        boolean agree, double resonance, double angleDiff,
        double fusionConf, double decayConf, double jointConf,
        boolean anomaly, String verdict,
        String innerDominant, String outerDominant
    ) {}

    public Comparison compare(InnerResult inner, OuterResult outer) {
        boolean agree     = inner.dominant().equals(outer.dominant());
        double iAngle     = DIR_ANGLES.get(inner.dominant());
        double oAngle     = DIR_ANGLES.get(outer.dominant());
        double angleDiff  = Math.abs(iAngle - oAngle);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;

        double resonance  = 1.0 - angleDiff / 180.0;
        double jointConf  = (inner.confidence() + outer.dominantScore()) / 2.0;
        boolean anomaly   = resonance < 0.33;

        String verdict = anomaly
            ? String.format("DIVERGENCIA – belső: %s, külső: %s", inner.dominant(), outer.dominant())
            : String.format("REZONANCIA – %s (%.0f%%)", inner.dominant(), resonance * 100);

        return new Comparison(agree, round4(resonance), angleDiff,
            round4(inner.confidence()), round4(outer.dominantScore()), round4(jointConf),
            anomaly, verdict, inner.dominant(), outer.dominant());
    }

    // ── Fő compute ───────────────────────────────────────────────────────────

    public record DecisionResult(
        long timestamp, InnerResult inner, OuterResult outer,
        Comparison comparison, Map<String, Double> weights
    ) {}

    public DecisionResult compute(Map<String, Double> values) {
        List<EvalVar> vars = CATALOG.stream().map(c -> eval(c, values)).collect(Collectors.toList());
        InnerResult  inner = computeInner(vars);
        OuterResult  outer = computeOuter(vars);
        Comparison   cmp   = compare(inner, outer);

        // Önfejlesztés: rezonáns egyezés erősíti az adaptációs súlyt
        if (cmp.agree() && cmp.resonance() > 0.7) {
            String adaptId = "adapt" + cap(inner.dominant());
            adaptWeight(adaptId, 0.01);
        }
        // Divergencia: felső változók súlyát csökkenti
        if (cmp.anomaly()) {
            inner.contributions().stream().limit(3)
                .forEach(c -> adaptWeight((String) c.get("id"), -0.005));
        }

        return new DecisionResult(System.currentTimeMillis(), inner, outer, cmp, getAllWeights());
    }

    private static String cap(String s) {
        return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    private static double round2(double v) { return Math.round(v * 100.0) / 100.0; }
    private static double round4(double v) { return Math.round(v * 10000.0) / 10000.0; }
    private static double round6(double v) { return Math.round(v * 1000000.0) / 1000000.0; }
}
