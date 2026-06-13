/**
 * Conjunction screening pipeline.
 *
 * Stage 1 — geometric sieve: discard any secondary whose radial shell cannot
 *   come within the gate of the primary's shell. This is an O(1) test per object
 *   and removes the overwhelming majority of the catalog before any expensive
 *   time propagation, which is what makes all-vs-one screening interactive.
 * Stage 2 — temporal search: march each survivor to find close approaches.
 * Stage 3 — probability: for each close approach, build the combined covariance
 *   and evaluate Foster Pc.
 */
import { R_EARTH, SCREENING_DISTANCE_GATE_KM, PC_ACTION_THRESHOLD } from "../astro/constants";
import { tleEpochMs } from "../astro/sgp4";
import type { Conjunction, Severity, SpaceObject, TLE } from "../astro/types";
import { eciCovariance, elementAgeDays } from "./covariance";
import { collisionProbability } from "./probability";
import { findCloseApproaches } from "./tca";

/** Per-class hard-body radius estimate, km (no published sizes in TLE data). */
export function hardBodyRadiusKm(type: TLE["type"]): number {
  switch (type) {
    case "PAYLOAD":
      return 0.005; // ~5 m envelope
    case "ROCKET_BODY":
      return 0.008; // ~8 m envelope
    case "DEBRIS":
      return 0.001; // ~1 m fragment
    default:
      return 0.003;
  }
}

export function severityFromPc(pc: number): Severity {
  if (pc >= PC_ACTION_THRESHOLD) return "CRITICAL";
  if (pc >= 1e-5) return "WARNING";
  if (pc >= 1e-7) return "WATCH";
  return "INFO";
}

/** Geometric sieve: can these two shells approach within the gate? */
function shellsCanApproach(a: SpaceObject, b: SpaceObject, gateKm: number): boolean {
  const ra1 = a.orbit.apogeeKm + R_EARTH;
  const rp1 = a.orbit.perigeeKm + R_EARTH;
  const ra2 = b.orbit.apogeeKm + R_EARTH;
  const rp2 = b.orbit.perigeeKm + R_EARTH;
  if (rp1 - ra2 > gateKm) return false;
  if (rp2 - ra1 > gateKm) return false;
  return true;
}

export interface ScreeningOptions {
  windowHours?: number;
  gateKm?: number;
  /** Cap on candidates time-searched, for responsiveness. */
  maxCandidates?: number;
  /** Progress callback (0..1). */
  onProgress?: (fraction: number) => void;
}

/**
 * Screen one primary object against the whole catalog and return conjunctions
 * sorted by collision probability (descending).
 */
export function screenPrimary(
  primary: SpaceObject,
  catalog: SpaceObject[],
  nowMs: number,
  opts: ScreeningOptions = {},
): Conjunction[] {
  const windowHours = opts.windowHours ?? 24;
  const gateKm = opts.gateKm ?? SCREENING_DISTANCE_GATE_KM;
  const tStart = nowMs;
  const tEnd = nowMs + windowHours * 3600_000;

  // Stage 1: geometric sieve.
  const candidates = catalog.filter(
    (o) => o.tle.noradId !== primary.tle.noradId && shellsCanApproach(primary, o, gateKm),
  );
  const limited = opts.maxCandidates ? candidates.slice(0, opts.maxCandidates) : candidates;

  const conjunctions: Conjunction[] = [];
  const primaryEpoch = tleEpochMs(primary.tle);

  for (let i = 0; i < limited.length; i++) {
    const sec = limited[i];
    if (opts.onProgress && i % 50 === 0) opts.onProgress(i / limited.length);

    const approaches = findCloseApproaches(primary.tle, sec.tle, tStart, tEnd, gateKm);
    if (approaches.length === 0) continue;

    const secEpoch = tleEpochMs(sec.tle);
    for (const ca of approaches) {
      // Stage 3: combined covariance + Foster Pc.
      const covPrimary = eciCovariance(ca.primaryState, {
        ageDays: elementAgeDays(primaryEpoch, ca.tcaMs),
        regime: primary.orbit.regime,
      });
      const covSecondary = eciCovariance(ca.secondaryState, {
        ageDays: elementAgeDays(secEpoch, ca.tcaMs),
        regime: sec.orbit.regime,
      });
      const covCombined = add9(covPrimary, covSecondary);

      const rRel: [number, number, number] = [
        ca.secondaryState.position[0] - ca.primaryState.position[0],
        ca.secondaryState.position[1] - ca.primaryState.position[1],
        ca.secondaryState.position[2] - ca.primaryState.position[2],
      ];
      const vRel: [number, number, number] = [
        ca.secondaryState.velocity[0] - ca.primaryState.velocity[0],
        ca.secondaryState.velocity[1] - ca.primaryState.velocity[1],
        ca.secondaryState.velocity[2] - ca.primaryState.velocity[2],
      ];
      const hbr = hardBodyRadiusKm(primary.tle.type) + hardBodyRadiusKm(sec.tle.type);
      const { pc } = collisionProbability(rRel, vRel, covCombined, hbr);

      conjunctions.push({
        primaryId: primary.tle.noradId,
        secondaryId: sec.tle.noradId,
        primaryName: primary.tle.name,
        secondaryName: sec.tle.name,
        tcaMs: ca.tcaMs,
        missKm: ca.missKm,
        relativeSpeedKmps: ca.relativeSpeedKmps,
        hardBodyRadiusKm: hbr,
        pc,
        severity: severityFromPc(pc),
      });
    }
  }

  if (opts.onProgress) opts.onProgress(1);
  return conjunctions.sort((a, b) => b.pc - a.pc);
}

/** Element-wise sum of two 3x3 matrices (covariance addition). */
function add9(
  A: readonly number[],
  B: readonly number[],
): [number, number, number, number, number, number, number, number, number] {
  return [
    A[0] + B[0], A[1] + B[1], A[2] + B[2],
    A[3] + B[3], A[4] + B[4], A[5] + B[5],
    A[6] + B[6], A[7] + B[7], A[8] + B[8],
  ];
}
