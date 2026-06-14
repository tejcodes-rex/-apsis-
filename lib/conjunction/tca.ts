/**
 * Time-of-closest-approach search.
 *
 * For each candidate pair that survives the geometric pre-filter we march the
 * relative distance across the screening window with a *distance-aware* step:
 * far apart we take large steps, and the step shrinks smoothly as the objects
 * approach the screening gate. Because the step is bounded by (d - gate)/v_rel,
 * an object physically cannot cross from outside the gate to a close approach
 * without the marcher first shrinking its step at the gate boundary, so fast
 * head-on geometries are not skipped the way a fixed coarse step would skip
 * them. Each detected dip is then refined to sub-second precision by
 * golden-section search on |r_rel(t)|.
 */
import { propagate } from "../astro/sgp4";
import type { StateVector, TLE, Vec3 } from "../astro/types";
import { norm, sub } from "../astro/vec";

export interface CloseApproach {
  tcaMs: number;
  missKm: number;
  relativeSpeedKmps: number;
  primaryState: StateVector;
  secondaryState: StateVector;
}

function relDistance(a: TLE, b: TLE, tMs: number): { d: number; vRel: number } | null {
  const sa = propagate(a, tMs);
  const sb = propagate(b, tMs);
  if (!sa || !sb) return null;
  const dr = sub(sb.position, sa.position);
  const dv = sub(sb.velocity, sa.velocity);
  return { d: norm(dr), vRel: norm(dv) };
}

const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** Golden-section minimisation of relative distance on [lo, hi] (ms). */
function refineMinimum(a: TLE, b: TLE, loMs: number, hiMs: number): CloseApproach | null {
  let lo = loMs;
  let hi = hiMs;
  let c = hi - GOLDEN * (hi - lo);
  let d = lo + GOLDEN * (hi - lo);
  const at = (t: number) => relDistance(a, b, t)?.d ?? Infinity;
  let fc = at(c);
  let fd = at(d);
  // ~25 iterations drives a multi-minute bracket below 1 ms.
  for (let i = 0; i < 40 && hi - lo > 1; i++) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - GOLDEN * (hi - lo);
      fc = at(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + GOLDEN * (hi - lo);
      fd = at(d);
    }
  }
  const tcaMs = (lo + hi) / 2;
  const sa = propagate(a, tcaMs);
  const sb = propagate(b, tcaMs);
  if (!sa || !sb) return null;
  const dr = sub(sb.position, sa.position);
  const dv: Vec3 = sub(sb.velocity, sa.velocity);
  return {
    tcaMs,
    missKm: norm(dr),
    relativeSpeedKmps: norm(dv),
    primaryState: sa,
    secondaryState: sb,
  };
}

/**
 * Find all close approaches under `gateKm` within [tStartMs, tEndMs].
 * Returns the closest few, sorted by miss distance.
 */
export function findCloseApproaches(
  primary: TLE,
  secondary: TLE,
  tStartMs: number,
  tEndMs: number,
  gateKm: number,
  opts: { minStepSec?: number; maxStepSec?: number } = {},
): CloseApproach[] {
  // A small floor so a deep, fast dip inside the gate is still resolved: at
  // ~15 km/s a sub-km miss is traversed in well under a second, so the step must
  // be able to shrink to a fraction of a second near closest approach.
  const minStep = (opts.minStepSec ?? 0.4) * 1000;
  const maxStep = (opts.maxStepSec ?? 120) * 1000;
  const results: CloseApproach[] = [];

  let t = tStartMs;
  let prev = relDistance(primary, secondary, t);
  let prevT = t;
  let prevPrevT = t; // the sample before `prev`, used to bracket a detected min
  let descending = false;

  while (t < tEndMs) {
    const cur = relDistance(primary, secondary, t);
    if (cur && prev) {
      // Detect a local minimum: distance was decreasing, now increasing.
      if (cur.d > prev.d && descending && prev.d < gateKm * 2) {
        // Bracket the minimum by its true neighbouring samples [prevPrevT, t],
        // which keeps the golden-section interval unimodal (no over-wide span).
        const refined = refineMinimum(primary, secondary, prevPrevT, t);
        if (refined && refined.missKm < gateKm) results.push(refined);
        descending = false;
      } else if (cur.d < prev.d) {
        descending = true;
      } else {
        descending = false;
      }
    }
    // Distance-aware step: bounded by how long until we could reach the gate.
    const d = cur?.d ?? Infinity;
    const v = Math.max(cur?.vRel ?? 1, 0.05);
    const margin = Math.max(d - gateKm, gateKm * 0.5);
    const step = Math.min(maxStep, Math.max(minStep, (margin / v) * 1000 * 0.5));
    prevPrevT = prevT;
    prev = cur;
    prevT = t;
    t += step;
  }

  return results.sort((x, y) => x.missKm - y.missKm).slice(0, 3);
}
