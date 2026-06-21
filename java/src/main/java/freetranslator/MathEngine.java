package freetranslator;

/**
 * FreeTranslator v2.1 – Math Engine (Java port)
 *
 * Determinisztikus reticle szög generátorok:
 *   Weyl     – arany arány alapú egyenletes lefedés
 *   Arnold   – Arnold macska térkép (kaotikus, de periodikus)
 *   Chebyshev – Chebyshev-polinóm (ergodikus)
 *
 * Burok (0-forma) sugár: rugalmas elliptikus deformáció
 * Rezgés:  hang sebessége v = 343 m/s referencia
 * Dinamikus sáv: static / dynamic / aberrated módok
 */
public class MathEngine {

    public static final double PHI    = (1.0 + Math.sqrt(5)) / 2.0;
    public static final double SOUND  = 343.0;  // m/s
    public static final double ARM    = 0.07;   // reticle kar hossz (m)

    // ── Reticle szög generátorok ─────────────────────────────────────────────

    /** Weyl-sorozat: szög = frac(step × φ) × 360 */
    public static double weylAngle(int step) {
        return frac(step * PHI) * 360.0;
    }

    /** Arnold-macska térkép: x_n+1 = (x_n + y_n) mod 1; y_n+1 = (x_n + 2y_n) mod 1 */
    public static double arnoldAngle(int step) {
        double x = 0.5, y = 0.5;
        for (int i = 0; i < step % 999 + 1; i++) {
            double nx = frac(x + y);
            double ny = frac(x + 2 * y);
            x = nx; y = ny;
        }
        return x * 360.0;
    }

    /** Chebyshev-iteráció: x_n+1 = cos(arccos(x_n) × 2) */
    public static double chebyshevAngle(int step) {
        double x = 0.7;
        for (int i = 0; i < step % 999 + 1; i++) {
            x = Math.cos(2.0 * Math.acos(Math.max(-1, Math.min(1, x))));
        }
        return ((x + 1.0) / 2.0) * 360.0;
    }

    /**
     * Reticle szög kiválasztása motor típus szerint.
     * @param step         lépésszám
     * @param engineType   "weyl" | "arnold" | "chebyshev"
     * @param matrixEnergy 0–100 energia érték (perturbáció hozzáadása)
     */
    public static double getReticleAngle(int step, String engineType, double matrixEnergy) {
        double base;
        switch (engineType == null ? "weyl" : engineType) {
            case "arnold":    base = arnoldAngle(step);    break;
            case "chebyshev": base = chebyshevAngle(step); break;
            default:          base = weylAngle(step);      break;
        }
        double perturbation = (matrixEnergy / 100.0) * Math.sin(step * 0.314) * 15.0;
        return normalizeAngle(base + perturbation);
    }

    // ── Burok (0-forma) sugár ────────────────────────────────────────────────

    /**
     * Rugalmas burok sugár adott szögnél.
     * Szinusz-alapú deformáció a reticle szög irányára merőlegesen.
     */
    public static double getBalloonRadius(double thetaDeg, double baseR,
                                          double retAngleDeg, double tension,
                                          double resonance, int step) {
        double theta = Math.toRadians(thetaDeg);
        double retR  = Math.toRadians(retAngleDeg);
        double diff  = theta - retR;

        double deform = (1.0 - tension) * resonance * 0.25 * Math.cos(2.0 * diff);
        double wave   = 0.04 * Math.sin(3.0 * theta + step * 0.05);
        return baseR * (1.0 + deform + wave);
    }

    /** Statikus alapsugár (tension alapú) */
    public static double staticBase(double tension) {
        return 0.35 + tension * 0.25;
    }

    /** Dinamikus alapsugár – szinuszos oszcilláció */
    public static double dynamicBase(int step, double matrixEnergy) {
        return 0.45 + 0.12 * Math.sin(step * 0.08) * (matrixEnergy / 100.0);
    }

    /**
     * Aberrált sávos sugár – Fourier-összeg, szög-függő harmónikusok.
     * A burok képes az átmérőjét korlátlanul dinamikázni (sávos mód).
     */
    public static double aberratedBase(double thetaDeg, int step, double matrixEnergy,
                                       double retAngleDeg) {
        double theta = Math.toRadians(thetaDeg);
        double energy = matrixEnergy / 100.0;
        double base = 0.40
            + 0.15 * Math.sin(theta * 2 + step * 0.06) * energy
            + 0.08 * Math.cos(theta * 3 - step * 0.04)
            + 0.05 * Math.sin(theta * 5 + step * 0.11) * (1 - energy)
            + 0.03 * Math.cos(theta * 7 - Math.toRadians(retAngleDeg));
        return Math.max(0.05, base);
    }

    // ── Mutató rezgés – hang referencia ────────────────────────────────────--

    public record VibrationResult(double freqHz, double ampNorm,
                                  double arcM, double wavelengthM, String note) {}

    /**
     * Mutató rezgés kiszámítása hangsebesség alapján.
     * arcLength = ARM × |Δθ_rad|
     * freqHz = SOUND / (2 × arcLength)   ha arcLength > 0
     */
    public static VibrationResult calcPointerVibration(double prevAngleDeg, double currAngleDeg) {
        double deltaRad = Math.toRadians(Math.abs(currAngleDeg - prevAngleDeg));
        if (deltaRad > Math.PI) deltaRad = 2 * Math.PI - deltaRad;

        double arcM = ARM * deltaRad;
        if (arcM < 1e-9) {
            return new VibrationResult(0, 0, 0, 0, "-");
        }

        double freqHz      = SOUND / (2.0 * arcM);
        double wavelengthM = SOUND / freqHz;
        double ampNorm     = Math.min(1.0, arcM / (ARM * Math.PI));
        String note        = freqToNote(freqHz);
        return new VibrationResult(freqHz, ampNorm, arcM, wavelengthM, note);
    }

    private static final String[] NOTE_NAMES = {"C","C#","D","D#","E","F","F#","G","G#","A","A#","B"};
    private static String freqToNote(double hz) {
        if (hz <= 0 || hz > 20000) return "-";
        int n   = (int) Math.round(12.0 * Math.log(hz / 440.0) / Math.log(2)) + 69;
        int oct = n / 12 - 1;
        return NOTE_NAMES[((n % 12) + 12) % 12] + oct;
    }

    // ── Kardinális eloszlás ──────────────────────────────────────────────────

    public record Distribution(int north, int east, int south, int west) {
        public String dominant() {
            int mx = Math.max(Math.max(north, east), Math.max(south, west));
            if (north == mx) return "north";
            if (east  == mx) return "east";
            if (south == mx) return "south";
            return "west";
        }
    }

    /** Reticle szög → É/K/D/Ny eloszlás százalékban */
    public static Distribution calcDistribution(double retAngle, double baseR,
                                                double tension, double resonance, int step) {
        double[] angles = {0, 90, 180, 270};
        double[] weights = new double[4];
        double total = 0;
        for (int i = 0; i < 4; i++) {
            double diff = Math.toRadians(normalizeAngle(retAngle - angles[i]));
            double r    = getBalloonRadius(angles[i], baseR, retAngle, tension, resonance, step);
            weights[i]  = Math.max(0, Math.cos(diff)) * r * (1 + resonance * 0.3);
            total      += weights[i];
        }
        if (total == 0) return new Distribution(25, 25, 25, 25);
        int n = (int) Math.round(weights[0] / total * 100);
        int e = (int) Math.round(weights[1] / total * 100);
        int s = (int) Math.round(weights[2] / total * 100);
        int w = 100 - n - e - s;
        return new Distribution(n, e, s, w);
    }

    // ── Segéd ────────────────────────────────────────────────────────────────

    private static double frac(double v) {
        return v - Math.floor(v);
    }

    public static double normalizeAngle(double a) {
        a = a % 360;
        return a < 0 ? a + 360 : a;
    }
}
