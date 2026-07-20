/**
 * Easing functions for animations. Implements cubic bezier curves via
 * closed-form solver (no external deps).
 *
 * All functions take t ∈ [0, 1] and return eased value ∈ [0, 1].
 */

export type EasingCurve = "linear" | "easeIn" | "easeOut" | "easeInOut";

/**
 * Cubic bezier solver for standard CSS easing curves.
 * Presets map to cubic-bezier control points:
 * - easeIn: (0, 0, 0.58, 1.0)
 * - easeOut: (0.42, 0, 1.0, 1.0)
 * - easeInOut: (0.42, 0, 0.58, 1.0)
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;

    // Solve for the parameter where the bezier's x equals the input t.
    let mid = t;

    // Newton-Raphson iterations for precision
    for (let i = 0; i < 8; i++) {
      const x = 3 * (1 - mid) * (1 - mid) * mid * x1 + 3 * (1 - mid) * mid * mid * x2 + mid * mid * mid;
      const dx = x - t;
      if (Math.abs(dx) < 1e-6) break;

      const derivative = 3 * (1 - mid) * (1 - mid) * x1 + 6 * (1 - mid) * mid * (x2 - x1) + 3 * mid * mid * (1 - x2);
      if (Math.abs(derivative) < 1e-6) break;

      mid = mid - dx / derivative;
      mid = Math.max(0, Math.min(1, mid));
    }

    // Evaluate y(mid)
    return 3 * (1 - mid) * (1 - mid) * mid * y1 + 3 * (1 - mid) * mid * mid * y2 + mid * mid * mid;
  };
}

const easingFns: Record<EasingCurve, (t: number) => number> = {
  linear: (t) => t,
  easeIn: cubicBezier(0, 0, 0.58, 1.0),
  easeOut: cubicBezier(0.42, 0, 1.0, 1.0),
  easeInOut: cubicBezier(0.42, 0, 0.58, 1.0),
};

export function ease(curve: EasingCurve, t: number): number {
  return easingFns[curve](t);
}
