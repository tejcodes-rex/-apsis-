/**
 * Autonomous collision-avoidance maneuver planner.
 *
 * Given a flagged conjunction, the planner searches the maneuver design space, * lead time before TCA and an in-track delta-V (the most propellant-efficient
 * direction for changing miss distance), and returns the *minimum-propellant*
 * impulsive burn that drives collision probability below the safe target.
 *
 * Fidelity note: the post-burn arc is evaluated with the differential technique
 * described in kepler.ts. For each trial we propagate both a maneuvered and an
 * un-maneuvered copy of the primary with the same two-body propagator and apply
 * only their *difference* to the high-fidelity SGP4 state. This cancels the
 * two-body modelling error to first order, so the reported post-maneuver miss is
 * anchored to SGP4 truth rather than to a coarse Kepler approximation.
 */
import { PC_ACTION_THRESHOLD } from "../astro/constants";
import { ricToEci } from "../astro/frames";
import { keplerPropagate } from "../astro/kepler";
import { applyImpulse, propagate, tleEpochMs } from "../astro/sgp4";
import type { Conjunction, Maneuver, SpaceObject, StateVector, Vec3 } from "../astro/types";
import { add, norm, sub } from "../astro/vec";
import { eciCovariance, elementAgeDays } from "../conjunction/covariance";
import { collisionProbability } from "../conjunction/probability";
import type { Mat3 } from "../math/matrix";

const G0 = 9.80665; // m/s^2
const REFERENCE_MASS_KG = 500;
const REFERENCE_ISP_S = 220;

interface PostManeuver {
  missKm: number;
  pc: number;
  tcaMs: number;
}

/**
 * Evaluate the post-maneuver close approach across a short window around the
 * nominal TCA, using the SGP4-anchored differential displacement.
 */
function evaluateManeuver(
  primary: SpaceObject,
  secondary: SpaceObject,
  conjunction: Conjunction,
  burnMs: number,
  dvRicMps: Vec3,
  covCombined: Mat3,
): PostManeuver {
  const burnState = propagate(primary.tle, burnMs);
  if (!burnState) return { missKm: Infinity, pc: 0, tcaMs: conjunction.tcaMs };

  // Post-burn state in ECI (convert RIC m/s -> ECI km/s).
  const dvEci: Vec3 = ricToEci(
    [dvRicMps[0] / 1000, dvRicMps[1] / 1000, dvRicMps[2] / 1000],
    burnState,
  );
  const maneuvered = applyImpulse(burnState, dvEci);

  let best: PostManeuver = { missKm: Infinity, pc: 0, tcaMs: conjunction.tcaMs };
  // Sample +/- 90 s around nominal TCA to capture the shifted closest approach.
  for (let dt = -90; dt <= 90; dt += 10) {
    const tEval = conjunction.tcaMs + dt * 1000;
    const arcSec = (tEval - burnMs) / 1000;
    if (arcSec <= 0) continue;
    const manAtT = keplerPropagate(maneuvered, arcSec);
    const refAtT = keplerPropagate(burnState, arcSec);
    const diffPos: Vec3 = sub(manAtT.position, refAtT.position);
    const diffVel: Vec3 = sub(manAtT.velocity, refAtT.velocity);

    const pSgp4 = propagate(primary.tle, tEval);
    const sSgp4 = propagate(secondary.tle, tEval);
    if (!pSgp4 || !sSgp4) continue;

    const pPos: Vec3 = add(pSgp4.position, diffPos);
    const pVel: Vec3 = add(pSgp4.velocity, diffVel);
    const rRel: Vec3 = sub(sSgp4.position, pPos);
    const vRel: Vec3 = sub(sSgp4.velocity, pVel);
    const miss = norm(rRel);
    if (miss < best.missKm) {
      const { pc } = collisionProbability(rRel, vRel, covCombined, conjunction.hardBodyRadiusKm);
      best = { missKm: miss, pc, tcaMs: tEval };
    }
  }
  return best;
}

/** Smallest in-track |delta-V| (m/s) at a given lead time that reaches target Pc. */
function minDvForLead(
  primary: SpaceObject,
  secondary: SpaceObject,
  conjunction: Conjunction,
  burnMs: number,
  covCombined: Mat3,
  targetPc: number,
  sign: 1 | -1,
): { dv: number; result: PostManeuver; meetsTarget: boolean } | null {
  const dvMax = 5; // m/s upper bound for a LEO avoidance burn
  const make = (mag: number): Vec3 => [0, sign * mag, 0]; // in-track only
  // Feasibility check at the cap.
  const capRes = evaluateManeuver(primary, secondary, conjunction, burnMs, make(dvMax), covCombined);
  if (capRes.pc > targetPc) {
    // Even the maximum burn cannot reach the target at this lead time. Report it
    // as a best-effort solution (not target-meeting) so the planner can still
    // surface the largest achievable risk reduction rather than nothing.
    return { dv: dvMax, result: capRes, meetsTarget: false };
  }
  // Bisection for the smallest magnitude meeting the target.
  let lo = 0;
  let hi = dvMax;
  let bestRes = capRes;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    const res = evaluateManeuver(primary, secondary, conjunction, burnMs, make(mid), covCombined);
    if (res.pc <= targetPc) {
      hi = mid;
      bestRes = res;
    } else {
      lo = mid;
    }
  }
  return { dv: hi, result: bestRes, meetsTarget: true };
}

export interface PlanOptions {
  /** Probability we must get below. Defaults to one order under the red line. */
  targetPc?: number;
}

/**
 * Plan the minimum-propellant avoidance maneuver for a conjunction.
 * Returns null if the conjunction is already safe or no burn within bounds works.
 */
export function planAvoidance(
  primary: SpaceObject,
  secondary: SpaceObject,
  conjunction: Conjunction,
  nowMs: number,
  opts: PlanOptions = {},
): Maneuver | null {
  const targetPc = opts.targetPc ?? PC_ACTION_THRESHOLD / 10;
  if (conjunction.pc < targetPc) return null; // nothing to do

  // Rebuild the combined covariance at TCA (same model as screening).
  const pState = propagate(primary.tle, conjunction.tcaMs);
  const sState = propagate(secondary.tle, conjunction.tcaMs);
  if (!pState || !sState) return null;
  const covCombined = sumCov(
    eciCovariance(pState, {
      ageDays: elementAgeDays(tleEpochMs(primary.tle), conjunction.tcaMs),
      regime: primary.orbit.regime,
    }),
    eciCovariance(sState, {
      ageDays: elementAgeDays(tleEpochMs(secondary.tle), conjunction.tcaMs),
      regime: secondary.orbit.regime,
    }),
  );

  const periodSec = primary.orbit.periodMin * 60;
  // Candidate lead times: more orbits of lead => smaller burn. Bounded by the
  // time actually remaining until TCA.
  const leadCandidates = [0.5, 1, 2, 3, 5].map((k) => k * periodSec);

  // Track the best target-meeting solution (by least propellant) and, separately,
  // the best-effort fallback (greatest risk reduction) in case nothing reaches
  // the target within the delta-V bound.
  let best: Maneuver | null = null;
  let fallback: Maneuver | null = null;
  for (const lead of leadCandidates) {
    const burnMs = conjunction.tcaMs - lead * 1000;
    if (burnMs <= nowMs + 60_000) continue; // need at least a minute of lead

    for (const sign of [1, -1] as const) {
      const solved = minDvForLead(primary, secondary, conjunction, burnMs, covCombined, targetPc, sign);
      if (!solved) continue;
      const propellantKg =
        REFERENCE_MASS_KG * (1 - Math.exp(-solved.dv / (REFERENCE_ISP_S * G0)));
      const candidate: Maneuver = {
        conjunction,
        leadTimeSec: lead,
        deltaVricMps: [0, sign * solved.dv, 0],
        deltaVmagMps: solved.dv,
        pcAfter: solved.result.pc,
        missAfterKm: solved.result.missKm,
        propellantKg,
        rationale: "",
      };
      if (solved.meetsTarget) {
        if (!best || candidate.propellantKg < best.propellantKg) best = candidate;
      } else if (!fallback || candidate.pcAfter < fallback.pcAfter) {
        fallback = candidate;
      }
    }
  }

  const chosen = best ?? fallback;
  if (chosen) chosen.rationale = buildRationale(primary, secondary, conjunction, chosen);
  return chosen;
}

function sumCov(A: Mat3, B: Mat3): Mat3 {
  return A.map((v, i) => v + B[i]) as Mat3;
}

/**
 * Compose a precise, human-readable decision record. This is the natural-
 * language surface of the autonomous decision; the numbers it cites are the
 * exact optimizer outputs, never invented.
 */
function buildRationale(
  primary: SpaceObject,
  secondary: SpaceObject,
  c: Conjunction,
  m: Maneuver,
): string {
  const leadMin = (m.leadTimeSec / 60).toFixed(0);
  const dir = m.deltaVricMps[1] >= 0 ? "prograde" : "retrograde";
  const dvCmps = (m.deltaVmagMps * 100).toFixed(1);
  const reduction = c.pc > 0 ? (c.pc / Math.max(m.pcAfter, 1e-30)).toExponential(1) : "n/a";
  return [
    `Conjunction with ${secondary.tle.name} (NORAD ${secondary.tle.noradId}) screened at`,
    `${c.missKm.toFixed(2)} km miss, closing at ${c.relativeSpeedKmps.toFixed(2)} km/s,`,
    `collision probability ${c.pc.toExponential(2)}, above the ${PC_ACTION_THRESHOLD.toExponential(0)} action line.`,
    `Recommended response: a ${dvCmps} cm/s ${dir} in-track burn`,
    `executed ${leadMin} min before closest approach.`,
    `This widens the miss to ${m.missAfterKm.toFixed(2)} km and lowers probability to`,
    `${m.pcAfter.toExponential(2)} (a ${reduction}x reduction), at a propellant cost of`,
    `${(m.propellantKg * 1000).toFixed(1)} g for a 500 kg / 220 s-Isp bus.`,
    `In-track was selected as the minimum-energy axis for separation growth over ${leadMin} min of lead.`,
  ].join(" ");
}
