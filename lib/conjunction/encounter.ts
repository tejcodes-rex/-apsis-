/**
 * Encounter-plane analysis for a single conjunction. This reuses the exact same
 * propagation, covariance, and Foster probability code as the screening engine,
 * but exposes the 2D encounter-plane geometry and the probability-vs-time profile
 * so the UI can render the analyst view of a conjunction (covariance ellipse,
 * hard-body disk, miss vector, and how risk evolves through closest approach).
 */
import { propagate, tleEpochMs } from "../astro/sgp4";
import type { SpaceObject, Vec3 } from "../astro/types";
import { sub } from "../astro/vec";
import { eciCovariance, elementAgeDays } from "./covariance";
import { collisionProbability, type PcResult } from "./probability";
import { hardBodyRadiusKm } from "./screening";
import type { Mat3 } from "../math/matrix";

function combinedCovariance(
  primary: SpaceObject,
  secondary: SpaceObject,
  pState: { position: Vec3; velocity: Vec3; epochMs: number },
  sState: { position: Vec3; velocity: Vec3; epochMs: number },
  atMs: number,
): Mat3 {
  const cp = eciCovariance(pState, {
    ageDays: elementAgeDays(tleEpochMs(primary.tle), atMs),
    regime: primary.orbit.regime,
  });
  const cs = eciCovariance(sState, {
    ageDays: elementAgeDays(tleEpochMs(secondary.tle), atMs),
    regime: secondary.orbit.regime,
  });
  return cp.map((v, i) => v + cs[i]) as Mat3;
}

export interface EncounterAnalysis extends PcResult {
  hbrKm: number;
}

/** Full encounter-plane geometry + Pc at the time of closest approach. */
export function analyzeConjunction(
  primary: SpaceObject,
  secondary: SpaceObject,
  tcaMs: number,
): EncounterAnalysis | null {
  const p = propagate(primary.tle, tcaMs);
  const s = propagate(secondary.tle, tcaMs);
  if (!p || !s) return null;
  const cov = combinedCovariance(primary, secondary, p, s, tcaMs);
  const rRel = sub(s.position, p.position);
  const vRel = sub(s.velocity, p.velocity);
  const hbr = hardBodyRadiusKm(primary.tle.type) + hardBodyRadiusKm(secondary.tle.type);
  const res = collisionProbability(rRel, vRel, cov, hbr);
  return { ...res, hbrKm: hbr };
}

export interface PcSample {
  tOffsetSec: number;
  pc: number;
  missKm: number;
}

/**
 * Probability and miss distance through the encounter, sampled across
 * [tca - spanSec, tca + spanSec]. Real conjunction tools track this profile
 * because the geometry (and therefore Pc) changes rapidly around TCA.
 */
export function pcOverTime(
  primary: SpaceObject,
  secondary: SpaceObject,
  tcaMs: number,
  spanSec = 600,
  samples = 61,
): PcSample[] {
  const out: PcSample[] = [];
  for (let i = 0; i < samples; i++) {
    const tOffsetSec = -spanSec + (2 * spanSec * i) / (samples - 1);
    const t = tcaMs + tOffsetSec * 1000;
    const p = propagate(primary.tle, t);
    const s = propagate(secondary.tle, t);
    if (!p || !s) continue;
    const cov = combinedCovariance(primary, secondary, p, s, t);
    const rRel = sub(s.position, p.position);
    const vRel = sub(s.velocity, p.velocity);
    const hbr = hardBodyRadiusKm(primary.tle.type) + hardBodyRadiusKm(secondary.tle.type);
    const res = collisionProbability(rRel, vRel, cov, hbr);
    out.push({ tOffsetSec, pc: res.pc, missKm: res.missPlaneKm });
  }
  return out;
}
