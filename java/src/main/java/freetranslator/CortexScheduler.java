package freetranslator;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.stream.*;

/**
 * FreeTranslator v2.1 – Cortex Dinamikus Ütemező (Java port)
 *
 * GPU-analóg terhelés elosztás:
 *   Warp   = CortexUnit     (egy feldolgozó egység)
 *   Blokk  = önbeágyazott egységfa (mászó mélységnövekedés)
 *   Shader = feladattípus (É/K/D/Ny) – reticle szög alapján
 *
 * Csúszó  – load balancing: legkisebb terhelésű egység kap feladatot
 * Mászó   – önbeágyazás: túlterhelt egység gyermeket szül (depth++)
 * Forgó   – vektorirányzék: reticle szög → feladattípus (0/90/180/270°)
 *
 * Hőszabályzás:
 *   thermal = EMA(egységek heat átlaga) – valós időben frissül
 *   COOL/WARM/HOT/CRITICAL sávok → Ollama throttle szorzók
 *
 * Thread-safe: ConcurrentHashMap + AtomicInteger
 */
public class CortexScheduler {

    // ── Thermal sávok ────────────────────────────────────────────────────────

    public enum ThermalBand {
        COOL    ("HŰVÖS",    0.30, 1.00, 1.00, 0),
        WARM    ("MELEG",    0.60, 0.85, 0.90, 0),
        HOT     ("FORRÓ",    0.80, 0.65, 0.70, 80),
        CRITICAL("KRITIKUS", 1.00, 0.40, 0.50, 200);

        public final String  label;
        public final double  maxLevel;
        public final double  ctxMult;
        public final double  predictMult;
        public final int     delayMs;

        ThermalBand(String label, double max, double ctx, double pred, int delay) {
            this.label = label; this.maxLevel = max;
            this.ctxMult = ctx; this.predictMult = pred; this.delayMs = delay;
        }

        public static ThermalBand of(double level) {
            for (ThermalBand b : values()) if (level <= b.maxLevel) return b;
            return CRITICAL;
        }
    }

    // ── CortexUnit ───────────────────────────────────────────────────────────

    public static class CortexUnit {
        private static final AtomicInteger SEQ = new AtomicInteger(1);

        public final String id;
        public final String type;
        public final int    depth;
        public final String parentId;

        private volatile double load  = 0;
        private volatile double heat  = 0;
        private volatile int    tasks = 0;
        private volatile boolean active = true;
        private volatile long   lastTaskMs = 0;

        private final List<CortexUnit> children = new CopyOnWriteArrayList<>();

        CortexUnit(String type, int depth, String parentId) {
            this.id       = String.format("CU%03d", SEQ.getAndIncrement());
            this.type     = type;
            this.depth    = depth;
            this.parentId = parentId;
        }

        /** Csúszó terhelés felvétel */
        synchronized void acquire(double complexity) {
            load = Math.min(1, load + complexity);
            heat = Math.min(1, heat + complexity * 0.35);
            tasks++;
            lastTaskMs = System.currentTimeMillis();
        }

        /** Hő-elmaradásos felszabadítás */
        synchronized void release(double complexity, long durationMs) {
            load = Math.max(0, load - complexity);
            double coolRate = complexity * 0.12 * Math.min(2.0, 1000.0 / Math.max(50, durationMs));
            heat = Math.max(0, heat - coolRate);
        }

        /** Mászó önbeágyazás – gyermek unit szülése */
        CortexUnit embed(String childType) {
            CortexUnit child = new CortexUnit(childType, depth + 1, id);
            children.add(child);
            return child;
        }

        public double getLoad()   { return load; }
        public double getHeat()   { return heat; }
        public int    getTasks()  { return tasks; }
        public boolean isActive() { return active; }
        public void retire()      { active = false; }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id); m.put("type", type); m.put("depth", depth);
            m.put("parentId", parentId);
            m.put("load",  Math.round(load  * 1000) / 1000.0);
            m.put("heat",  Math.round(heat  * 1000) / 1000.0);
            m.put("tasks", tasks); m.put("active", active);
            m.put("childCount", children.stream().filter(CortexUnit::isActive).count());
            return m;
        }
    }

    // ── Scheduler ────────────────────────────────────────────────────────────

    private static final List<String> TASK_TYPES = List.of("north","east","south","west");
    private static final Map<String, Integer> TYPE_ANGLES =
        Map.of("north",0,"east",90,"south",180,"west",270);

    private final Map<String, CortexUnit> units = new ConcurrentHashMap<>();
    private volatile double thermal = 0;
    private final List<Map<String, Object>> log = new CopyOnWriteArrayList<>();

    public CortexScheduler() {
        for (String t : TASK_TYPES) {
            CortexUnit u = new CortexUnit(t, 0, null);
            units.put(u.id, u);
        }
    }

    /** Forgó vektorirányzék: reticle szög → feladattípus */
    public String angleToType(double deg) {
        double a = ((deg % 360) + 360) % 360;
        return TASK_TYPES.stream().min(Comparator.comparingDouble(t -> {
            double diff = Math.abs(a - TYPE_ANGLES.get(t));
            return Math.min(diff, 360 - diff);
        })).orElse("east");
    }

    /**
     * Egység foglalás – csúszó load balancing + mászó önbeágyazás ha szükséges.
     * Ha nincs szabad (load ≤ 0.85) azonos típusú egység → önbeágyazás.
     */
    public CortexUnit allocate(String type, double complexity, Double reticleAngle) {
        String taskType = (reticleAngle != null) ? angleToType(reticleAngle) : (type != null ? type : "east");

        List<CortexUnit> free = units.values().stream()
            .filter(u -> u.isActive() && u.type.equals(taskType) && u.getLoad() <= 0.85)
            .sorted(Comparator.comparingDouble(CortexUnit::getLoad))
            .collect(Collectors.toList());

        CortexUnit unit;
        if (!free.isEmpty()) {
            unit = free.get(0);
        } else {
            // Mászó önbeágyazás
            Optional<CortexUnit> deepest = units.values().stream()
                .filter(u -> u.isActive() && u.type.equals(taskType))
                .max(Comparator.comparingInt(u -> u.depth));

            if (deepest.isPresent()) {
                unit = deepest.get().embed(taskType);
                units.put(unit.id, unit);
            } else {
                unit = units.values().stream()
                    .filter(CortexUnit::isActive)
                    .min(Comparator.comparingDouble(CortexUnit::getLoad))
                    .orElseThrow(() -> new IllegalStateException("No active cortex unit"));
            }
        }

        unit.acquire(complexity);
        tick(taskType, complexity, "acquire");
        return unit;
    }

    /** Feladat befejezése + hőszabályzó felszabadítás */
    public void release(String unitId, double complexity, long durationMs) {
        CortexUnit unit = units.get(unitId);
        if (unit == null) return;
        unit.release(complexity, durationMs);
        tick(unit.type, complexity, "release");
        if (unit.depth > 0 && unit.getLoad() < 0.04 && unit.getTasks() > 0) {
            unit.retire();
        }
    }

    private synchronized void tick(String type, double complexity, String phase) {
        List<CortexUnit> active = activeUnits();
        double avgHeat = active.stream().mapToDouble(CortexUnit::getHeat).average().orElse(0);
        thermal = thermal * 0.72 + avgHeat * 0.28;

        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("ts", System.currentTimeMillis());
        entry.put("type", type); entry.put("complexity", complexity); entry.put("phase", phase);
        log.add(entry);
        if (log.size() > 20) log.remove(0);
    }

    /** GPU-analóg Ollama paraméter throttling */
    public ThrottleResult throttleParams(int numCtx, int numPredict, double temperature) {
        ThermalBand band = ThermalBand.of(thermal);
        int   ctx  = Math.max(512,  (int)(numCtx     * band.ctxMult));
        int   pred = Math.max(64,   (int)(numPredict  * band.predictMult));
        double temp = band == ThermalBand.CRITICAL ? temperature * 1.15 : temperature;
        return new ThrottleResult(ctx, pred, Math.round(temp * 100.0) / 100.0, band);
    }

    public record ThrottleResult(int numCtx, int numPredict, double temperature, ThermalBand band) {
        public int delayMs() { return band.delayMs; }
    }

    public ThermalBand getThermalBand() { return ThermalBand.of(thermal); }
    public double getThermal()          { return thermal; }
    public int getThermalPct()          { return (int) Math.round(thermal * 100); }

    private List<CortexUnit> activeUnits() {
        return units.values().stream().filter(CortexUnit::isActive).collect(Collectors.toList());
    }

    public int getMaxDepth() {
        return activeUnits().stream().mapToInt(u -> u.depth).max().orElse(0);
    }

    /** Terhelés eloszlás irányonként */
    public Map<String, Map<String, Object>> getLoadDist() {
        Map<String, Map<String, Object>> dist = new LinkedHashMap<>();
        for (String t : TASK_TYPES) {
            List<CortexUnit> us = activeUnits().stream()
                .filter(u -> u.type.equals(t)).collect(Collectors.toList());
            double avg = us.stream().mapToDouble(CortexUnit::getLoad).average().orElse(0);
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("count",   us.size());
            entry.put("avgLoad", Math.round(avg * 1000.0) / 1000.0);
            dist.put(t, entry);
        }
        return dist;
    }

    /** Teljes állapot snapshot */
    public Map<String, Object> status() {
        ThermalBand band   = ThermalBand.of(thermal);
        List<CortexUnit> active = activeUnits();
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("thermal",    Math.round(thermal * 10000.0) / 10000.0);
        s.put("thermalPct", getThermalPct());
        s.put("bandName",   band.name());
        s.put("bandLabel",  band.label);
        s.put("ctxMult",    band.ctxMult);
        s.put("predictMult",band.predictMult);
        s.put("delayMs",    band.delayMs);
        s.put("unitCount",  active.size());
        s.put("maxDepth",   getMaxDepth());
        s.put("load",       getLoadDist());
        s.put("units",      active.stream().map(CortexUnit::toMap).collect(Collectors.toList()));
        s.put("log",        log.stream().skip(Math.max(0, log.size()-10)).collect(Collectors.toList()));
        return s;
    }
}
