/**
 * SGP4 propagation layer.
 *
 * We use satellite.js for the SGP4/SDP4 core because re-deriving the analytic
 * perturbation model adds risk without adding insight, the value APSIS creates
 * is in the conjunction, probability, and maneuver layers built on top of it.
 * This module wraps the library in a typed, cached, frame-consistent interface
 * and derives the classical orbit summary we use for filtering and display.
 */
import * as sat from "satellite.js";
import { MU_EARTH, R_EARTH } from "./constants";
import type { OrbitSummary, StateVector, TLE, Vec3 } from "./types";

type SatRec = sat.SatRec;

/** Lazily-built, cached SGP4 records keyed by NORAD id. */
const recordCache = new Map<number, SatRec>();

function getRecord(tle: TLE): SatRec {
  const cached = recordCache.get(tle.noradId);
  if (cached) return cached;
  const rec = sat.twoline2satrec(tle.line1, tle.line2);
  recordCache.set(tle.noradId, rec);
  return rec;
}

/** Clear the record cache (used when a fresh catalog is loaded). */
export function resetPropagatorCache(): void {
  recordCache.clear();
}

/**
 * Propagate one object to an absolute time. Returns null if SGP4 reports an
 * error (decayed object, deep-space convergence failure, etc.) so callers can
 * cleanly skip dead entries rather than poison a screening batch.
 */
export function propagate(tle: TLE, epochMs: number): StateVector | null {
  const rec = getRecord(tle);
  const date = new Date(epochMs);
  const pv = sat.propagate(rec, date);
  if (!pv || !pv.position || !pv.velocity) return null;
  const p = pv.position as { x: number; y: number; z: number };
  const v = pv.velocity as { x: number; y: number; z: number };
  if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) return null;
  if (!isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)) return null;
  // Reject physically impossible states: an object propagated below the Earth's
  // surface has decayed/reentered (SGP4 does not always flag this), and a radius
  // beyond deep cislunar space indicates a diverged solution. Either way the
  // state is not usable for screening or display, so we drop it cleanly.
  const r2 = p.x * p.x + p.y * p.y + p.z * p.z;
  if (r2 < 6200 * 6200 || r2 > 600000 * 600000) return null;
  return {
    epochMs,
    position: [p.x, p.y, p.z],
    velocity: [v.x, v.y, v.z],
  };
}

/** Epoch of the element set in milliseconds since the Unix epoch (UTC). */
export function tleEpochMs(tle: TLE): number {
  const rec = getRecord(tle);
  // jdsatepoch is the Julian date of the element-set epoch.
  return (rec.jdsatepoch - 2440587.5) * 86_400_000;
}

/** Sub-satellite point in geodetic coordinates (degrees / km altitude). */
export function geodetic(state: StateVector): { latDeg: number; lonDeg: number; altKm: number } {
  const gmst = sat.gstime(new Date(state.epochMs));
  const eci = { x: state.position[0], y: state.position[1], z: state.position[2] };
  const geo = sat.eciToGeodetic(eci as sat.EciVec3<number>, gmst);
  return {
    latDeg: sat.degreesLat(geo.latitude),
    lonDeg: sat.degreesLong(geo.longitude),
    altKm: geo.height,
  };
}

/** Derive a classical-ish orbit summary directly from the SGP4 record. */
export function summarize(tle: TLE): OrbitSummary {
  const rec = getRecord(tle);
  // satrec.no is mean motion in radians/minute.
  const nRadPerSec = rec.no / 60;
  const a = Math.cbrt(MU_EARTH / (nRadPerSec * nRadPerSec)); // semi-major axis, km
  const ecc = rec.ecco;
  const apogeeKm = a * (1 + ecc) - R_EARTH;
  const perigeeKm = a * (1 - ecc) - R_EARTH;
  const inclinationDeg = (rec.inclo * 180) / Math.PI;
  const periodMin = (2 * Math.PI) / rec.no;

  let regime: OrbitSummary["regime"] = "LEO";
  const meanAlt = (apogeeKm + perigeeKm) / 2;
  if (ecc > 0.25 && apogeeKm > 25000) regime = "HEO";
  else if (meanAlt > 34000) regime = "GEO";
  else if (meanAlt > 2000) regime = "MEO";
  else regime = "LEO";

  return { apogeeKm, perigeeKm, inclinationDeg, periodMin, regime };
}

/** Apply an instantaneous ECI delta-V (km/s) to a state, producing a new state. */
export function applyImpulse(state: StateVector, dvEci: Vec3): StateVector {
  return {
    epochMs: state.epochMs,
    position: state.position,
    velocity: [
      state.velocity[0] + dvEci[0],
      state.velocity[1] + dvEci[1],
      state.velocity[2] + dvEci[2],
    ],
  };
}
