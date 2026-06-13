/**
 * Position-uncertainty model.
 *
 * TLE/GP data does not ship a covariance, yet collision probability is
 * meaningless without one. We therefore model the position covariance the way
 * operational TLE-only screening does: a diagonal covariance in the object's
 * RIC frame whose dominant axis is in-track, with all axes growing with the age
 * of the element set (older elements => larger uncertainty). The numbers below
 * are deliberately conservative and are surfaced in the UI so the assumption is
 * explicit rather than hidden. Replacing this with operator-supplied covariance
 * (CDM/OD output) is a drop-in change to this single function.
 */
import { diag3, mul3, transpose3, type Mat3 } from "../math/matrix";
import type { RicBasis } from "../astro/frames";
import type { StateVector } from "../astro/types";
import { ricBasis } from "../astro/frames";

export interface UncertaintyInputs {
  /** Age of the element set at the conjunction time, in days. */
  ageDays: number;
  regime: "LEO" | "MEO" | "GEO" | "HEO";
}

/** 1-sigma position uncertainties in the RIC frame, km. */
export function ricSigmas(input: UncertaintyInputs): { sr: number; si: number; sc: number } {
  const age = Math.max(0, input.ageDays);
  // Base uncertainty at epoch and growth rate per day. In-track dominates and
  // grows fastest because along-track timing error accumulates with each orbit.
  const regimeScale = input.regime === "LEO" ? 1 : input.regime === "MEO" ? 1.6 : 2.2;
  const sr = (0.06 + 0.18 * age) * regimeScale; // radial
  const si = (0.18 + 0.95 * age) * regimeScale; // in-track (dominant)
  const sc = (0.08 + 0.25 * age) * regimeScale; // cross-track
  return { sr, si, sc };
}

/**
 * Build the 3x3 ECI position covariance for an object at a state, given the age
 * of its element set. We form a diagonal covariance in RIC and rotate it into
 * ECI via the RIC basis: C_eci = Bᵀ · diag(σ²) · B, where B maps ECI -> RIC.
 */
export function eciCovariance(state: StateVector, input: UncertaintyInputs): Mat3 {
  const { sr, si, sc } = ricSigmas(input);
  const covRic = diag3(sr * sr, si * si, sc * sc);
  const basis: RicBasis = ricBasis(state);
  // B has the RIC unit vectors as rows (maps ECI vector -> RIC components).
  const B: Mat3 = [
    basis.R[0], basis.R[1], basis.R[2],
    basis.I[0], basis.I[1], basis.I[2],
    basis.C[0], basis.C[1], basis.C[2],
  ];
  // C_eci = Bᵀ · covRic · B
  return mul3(transpose3(B), mul3(covRic, B));
}

/** Age in days of a TLE epoch relative to a target time. */
export function elementAgeDays(tleEpochMs: number, targetMs: number): number {
  return (targetMs - tleEpochMs) / 86_400_000;
}
