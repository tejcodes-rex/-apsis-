/**
 * All-pairs conjunction sieve (spatial-hash / "cube" filter).
 *
 * Screening every object against every other is O(n^2) and intractable for a
 * full catalog. Real systems instead bin propagated positions into a 3D spatial
 * hash at each time sample and only consider pairs that share a local
 * neighbourhood — reducing the work to roughly O(n) per time step. We march a
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

export interface SieveOptions {
  windowHours?: number;
  stepSec?: number;
  gateKm?: number;
  cellKm?: number;
  /** Max relative speed assumed when sizing the neighbourhood, km/s. */
  maxRelSpeedKmps?: number;
  onProgress?: (fraction: number, phase: string) => void;
}

type PairKey = number; // packed (minId, maxId)
function packPair(a: number, b: number): PairKey {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo * 100000 + hi; // ids well under 1e5 in practice; collision-free here
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
    maxRelSpeedKmps: options.maxRelSpeedKmps ?? 16,
  };
  const byId = new Map(objects.map((obj) => [obj.tle.noradId, obj]));
  const candidates = gatherCandidates(objects, nowMs, o, options.onProgress);

  const conjunctions: Conjunction[] = [];
  const tEnd = nowMs + o.windowHours * 3600_000;
  let done = 0;
  for (const key of candidates) {
    const hi = key % 100000;
    const lo = (key - hi) / 100000;
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
        severity: severityFromPc(pc),
      });
    }
    if (options.onProgress && done % 20 === 0) {
      options.onProgress(0.6 + (done / candidates.size) * 0.4, "refining candidates");
    }
  }
  if (options.onProgress) options.onProgress(1, "done");
  // De-dup (a pair can yield multiple approaches): keep the riskiest per pair.
  const bestByPair = new Map<PairKey, Conjunction>();
  for (const c of conjunctions) {
    const k = packPair(c.primaryId, c.secondaryId);
    const cur = bestByPair.get(k);
    if (!cur || c.pc > cur.pc) bestByPair.set(k, c);
  }
  return Array.from(bestByPair.values()).sort((x, y) => y.pc - x.pc);
}

function sumCov(A: Mat3, B: Mat3): Mat3 {
  return A.map((v, i) => v + B[i]) as Mat3;
}
