/**
 * Reference-frame utilities.
 *
 * The RIC (radial / in-track / cross-track, also called RSW) frame is centred on
 * a chosen primary object and is the natural frame for both conjunction geometry
 * and maneuver design: a burn is most efficient in-track, and miss distance is
 * cleanest to reason about in radial/cross-track components.
 */
import type { StateVector, Vec3 } from "./types";
import { cross, dot, sub, unit } from "./vec";

export interface RicBasis {
  /** Radial unit vector (points from Earth centre to the object). */
  R: Vec3;
  /** In-track unit vector (completes the right-handed set; ~velocity dir). */
  I: Vec3;
  /** Cross-track unit vector (orbit normal). */
  C: Vec3;
}

/** Build the RIC orthonormal basis from a state vector. */
export function ricBasis(state: StateVector): RicBasis {
  const R = unit(state.position);
  const C = unit(cross(state.position, state.velocity));
  // I = C x R gives the in-track direction completing a right-handed frame.
  const I = cross(C, R);
  return { R, I, C };
}

/** Express an ECI vector in the RIC frame of `primary`. */
export function eciToRic(vecEci: Vec3, primary: StateVector): Vec3 {
  const { R, I, C } = ricBasis(primary);
  return [dot(vecEci, R), dot(vecEci, I), dot(vecEci, C)];
}

/** Convert a RIC-frame vector back into ECI given the primary basis. */
export function ricToEci(vecRic: Vec3, primary: StateVector): Vec3 {
  const { R, I, C } = ricBasis(primary);
  return [
    R[0] * vecRic[0] + I[0] * vecRic[1] + C[0] * vecRic[2],
    R[1] * vecRic[0] + I[1] * vecRic[1] + C[1] * vecRic[2],
    R[2] * vecRic[0] + I[2] * vecRic[1] + C[2] * vecRic[2],
  ];
}

/** Relative position of secondary with respect to primary, in the RIC frame. */
export function relativePositionRic(primary: StateVector, secondary: StateVector): Vec3 {
  return eciToRic(sub(secondary.position, primary.position), primary);
}
