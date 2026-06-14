/**
 * All-pairs conjunction sieve (spatial-hash / "cube" filter).
 *
 * Screening every object against every other is O(n^2) and intractable for a
 * full catalog. Real systems instead bin propagated positions into a 3D spatial
 * hash at each time sample and only consider pairs that share a local
 * neighbourhood, reducing the work to roughly O(n) per time step. We march a
 * coarse time grid, collect every pair that ever falls within the search
 * neighbourhood, then hand those few candidates to the precise TCA + Foster Pc
 * refinement. The neighbourhood radius is sized to (gate + max-travel-per-step)
 * so no genuine close approach can slip between samples.
 */
import { tleEpochMs } from "../astro/sgp4";
import { propagate } from "../astro/sgp4";
import type { Conjunction, SpaceObject } from "../astro/types";
import { eciCovariance, elementAgeDays } from "./covariance";
import { collisionProbability } from "./probability";
import { hardBodyRadiusKm, severityFromPc } from "./screening";
import { findCloseApproaches } from "./tca";
import type { Mat3 } from "../math/matrix";
import { sub } from "../astro/vec";
import { MIN_FOSTER_REL_SPEED_KMPS, MU_EARTH, R_EARTH } from "../astro/constants";

/**
 * Physical upper bound on the relative speed of any pair in a set, km/s. The
 * fastest an object moves is at perigee (vis-viva), and the largest closing
 * speed is a head-on encounter, so 2 x max perigee speed (with a small margin)
 * bounds every pair. Sizing the sieve neighbourhood with this guarantees no
 * hypervelocity conjunction can slip between time samples, rather than trusting
 * a hard-coded ceiling that a fast eccentric crosser could exceed.
 */
function maxRelativeSpeedKmps(objects: SpaceObject[]): number {
  let vMax = 7.9; // floor at circular LEO speed
  for (const o of objects) {
    const rp = o.orbit.perigeeKm + R_EARTH;
    const ra = o.orbit.apogeeKm + R_EARTH;
    if (rp <= 0) continue;
    const a = (rp + ra) / 2;
    const vp = Math.sqrt(Math.max(0, MU_EARTH * (2 / rp - 1 / a)));
    if (isFinite(vp) && vp > vMax) vMax = vp;
  }
  return 2 * vMax * 1.1; // head-on, plus 10% margin
}

export interface SieveOptions {
  windowHours?: number;
  stepSec?: number;
  gateKm?: number;
  cellKm?: number;
  /** Max relative speed assumed when sizing the neighbourhood, km/s. */
  maxRelSpeedKmps?: number;
  onProgress?: (fraction: number, phase: string) => void;
}

type PairKey = string; // "minId_maxId"; a string key avoids any id-range packing limit
function packPair(a: number, b: number): PairKey {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `${lo}_${hi}`;
}

/** Find candidate pairs that ever share a spatial neighbourhood. */
function gatherCandidates(
  objects: SpaceObject[],
  nowMs: number,
  o: Required<Omit<SieveOptions, "onProgress">>,
  onProgress?: SieveOptions["onProgress"],
): Set<PairKey> {
  const steps = Math.ceil((o.windowHours * 3600) / o.stepSec);
  const L = o.cellKm;
  // Neighbourhood radius in cells: cover gate + how far an object travels per step.
  const reach = Math.ceil((o.gateKm + o.maxRelSpeedKmps * o.stepSec) / L);
  const candidates = new Set<PairKey>();

  for (let s = 0; s <= steps; s++) {
    const t = nowMs + s * o.stepSec * 1000;
    const grid = new Map<string, number[]>(); // cellKey -> indices
    const pos: ([number, number, number] | null)[] = new Array(objects.length);

    for (let i = 0; i < objects.length; i++) {
      const st = propagate(objects[i].tle, t);
      if (!st) {
        pos[i] = null;
        continue;
      }
      pos[i] = st.position;
      const cx = Math.floor(st.position[0] / L);
      const cy = Math.floor(st.position[1] / L);
      const cz = Math.floor(st.position[2] / L);
      const key = `${cx},${cy},${cz}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }

    // For each occupied cell, test against itself + forward neighbours only
    // (to avoid double-checking neighbour pairs).
    for (const [key, idxs] of grid) {
      const [cx, cy, cz] = key.split(",").map(Number);
      for (let dx = -reach; dx <= reach; dx++)
        for (let dy = -reach; dy <= reach; dy++)
          for (let dz = -reach; dz <= reach; dz++) {
            const nKey = `${cx + dx},${cy + dy},${cz + dz}`;
            const nb = grid.get(nKey);
            if (!nb) continue;
            for (const i of idxs) {
              const pi = pos[i];
              if (!pi) continue;
              for (const j of nb) {
                if (j <= i) continue;
                const pj = pos[j];
                if (!pj) continue;
                const dxx = pi[0] - pj[0];
                const dyy = pi[1] - pj[1];
                const dzz = pi[2] - pj[2];
                const reachKm = o.gateKm + o.maxRelSpeedKmps * o.stepSec;
                if (dxx * dxx + dyy * dyy + dzz * dzz <= reachKm * reachKm) {
                  candidates.add(packPair(objects[i].tle.noradId, objects[j].tle.noradId));
                }
              }
            }
          }
    }
    if (onProgress && s % 5 === 0) onProgress((s / steps) * 0.6, "spatial sieve");
  }
  return candidates;
}

/** Full all-pairs screen of a catalog (or subset). Returns conjunctions by Pc. */
export function screenAllPairs(
  objects: SpaceObject[],
  nowMs: number,
  options: SieveOptions = {},
): Conjunction[] {
  const o = {
    windowHours: options.windowHours ?? 12,
    stepSec: options.stepSec ?? 20,
    gateKm: options.gateKm ?? 10,
    cellKm: options.cellKm ?? 60,
    // Derive the relative-speed bound from the actual screened set so the
    // neighbourhood is large enough for the fastest possible pair.
    maxRelSpeedKmps: options.maxRelSpeedKmps ?? maxRelativeSpeedKmps(objects),
  };
  const byId = new Map(objects.map((obj) => [obj.tle.noradId, obj]));
  const candidates = gatherCandidates(objects, nowMs, o, options.onProgress);

  const conjunctions: Conjunction[] = [];
  const tEnd = nowMs + o.windowHours * 3600_000;
  let done = 0;
  for (const key of candidates) {
    const [lo, hi] = key.split("_").map(Number);
    const a = byId.get(lo);
    const b = byId.get(hi);
    done++;
    if (!a || !b) continue;
    const approaches = findCloseApproaches(a.tle, b.tle, nowMs, tEnd, o.gateKm);
    for (const ca of approaches) {
      const cov = sumCov(
        eciCovariance(ca.primaryState, {
          ageDays: elementAgeDays(tleEpochMs(a.tle), ca.tcaMs),
          regime: a.orbit.regime,
        }),
        eciCovariance(ca.secondaryState, {
          ageDays: elementAgeDays(tleEpochMs(b.tle), ca.tcaMs),
          regime: b.orbit.regime,
        }),
      );
      const rRel = sub(ca.secondaryState.position, ca.primaryState.position);
      const vRel = sub(ca.secondaryState.velocity, ca.primaryState.velocity);
      // Use the same per-class hard-body model as the live screen so featured
      // events and live re-screening report identical probabilities.
      const hbr = hardBodyRadiusKm(a.tle.type) + hardBodyRadiusKm(b.tle.type);
      const { pc } = collisionProbability(rRel, vRel, cov, hbr);
      const fosterValid = ca.relativeSpeedKmps >= MIN_FOSTER_REL_SPEED_KMPS;
      conjunctions.push({
        primaryId: a.tle.noradId,
        secondaryId: b.tle.noradId,
        primaryName: a.tle.name,
        secondaryName: b.tle.name,
        tcaMs: ca.tcaMs,
        missKm: ca.missKm,
        relativeSpeedKmps: ca.relativeSpeedKmps,
        hardBodyRadiusKm: hbr,
        pc,
        fosterValid,
        severity: severityFromPc(pc, fosterValid),
      });
    }
    if (options.onProgress && done % 20 === 0) {
      options.onProgress(0.6 + (done / candidates.size) * 0.4, "refining candidates");
    }
  }
  if (options.onProgress) options.onProgress(1, "done");
  // De-dup (a pair can yield multiple approaches): keep the riskiest per pair.
  const bestByPair = new Map<PairKey, Conjunction>();
  const rank = (c: Conjunction) => (c.fosterValid ? c.pc : -1);
  for (const c of conjunctions) {
    const k = packPair(c.primaryId, c.secondaryId);
    const cur = bestByPair.get(k);
    if (!cur || rank(c) > rank(cur)) bestByPair.set(k, c);
  }
  return Array.from(bestByPair.values()).sort((x, y) => rank(y) - rank(x));
}

function sumCov(A: Mat3, B: Mat3): Mat3 {
  return A.map((v, i) => v + B[i]) as Mat3;
}
