/**
 * Two-body (Keplerian) state propagation via universal variables (Vallado,
 * "Fundamentals of Astrodynamics and Applications", Algorithm 8).
 *
 * SGP4 propagates from mean elements and cannot continue from an arbitrary
 * post-burn state vector. For the short arc between a maneuver and the time of
 * closest approach (minutes to a few hours) two-body motion captures the
 * dominant dynamics. Critically, we never use this propagator as an absolute
 * truth model: the maneuver optimizer takes the *difference* between a
 * maneuvered and an un-maneuvered two-body propagation and applies that
 * differential to the high-fidelity SGP4 state, which cancels the two-body
 * modelling error to first order.
 */
import { MU_EARTH } from "./constants";
import type { StateVector, Vec3 } from "./types";
import { add, cross, dot, norm, scale, sub } from "./vec";

const C2C3 = (psi: number): { c2: number; c3: number } => {
  if (psi > 1e-6) {
    const sq = Math.sqrt(psi);
    return { c2: (1 - Math.cos(sq)) / psi, c3: (sq - Math.sin(sq)) / Math.sqrt(psi * psi * psi) };
  }
  if (psi < -1e-6) {
    const sq = Math.sqrt(-psi);
    return {
      c2: (1 - Math.cosh(sq)) / psi,
      c3: (Math.sinh(sq) - sq) / Math.sqrt(-(psi * psi * psi)),
    };
  }
  return { c2: 1 / 2, c3: 1 / 6 };
};

/**
 * Propagate a Cartesian state by dtSec seconds under two-body gravity.
 * Returns the new state (same epoch base + dt).
 */
export function keplerPropagate(state: StateVector, dtSec: number): StateVector {
  const mu = MU_EARTH;
  const r0 = state.position;
  const v0 = state.velocity;
  const r0mag = norm(r0);
  const v0mag = norm(v0);
  const rdotv = dot(r0, v0);
  const alpha = -(v0mag * v0mag) / mu + 2 / r0mag; // 1/a

  // Initial guess for universal variable chi.
  let chi: number;
  if (alpha > 1e-9) {
    chi = Math.sqrt(mu) * dtSec * alpha; // elliptical
  } else if (alpha < -1e-9) {
    const a = 1 / alpha;
    chi =
      Math.sign(dtSec) *
      Math.sqrt(-a) *
      Math.log(
        (-2 * mu * alpha * dtSec) /
          (rdotv + Math.sign(dtSec) * Math.sqrt(-mu * a) * (1 - r0mag * alpha)),
      );
  } else {
    chi = (Math.sqrt(mu) * dtSec) / r0mag; // near-parabolic
  }

  const sqrtMu = Math.sqrt(mu);
  let psi = 0;
  let c2 = 0.5;
  let c3 = 1 / 6;
  let r = r0mag;

  for (let i = 0; i < 60; i++) {
    psi = chi * chi * alpha;
    ({ c2, c3 } = C2C3(psi));
    r = chi * chi * c2 + (rdotv / sqrtMu) * chi * (1 - psi * c3) + r0mag * (1 - psi * c2);
    const dchi =
      (sqrtMu * dtSec -
        chi * chi * chi * c3 -
        (rdotv / sqrtMu) * chi * chi * c2 -
        r0mag * chi * (1 - psi * c3)) /
      r;
    chi += dchi;
    if (Math.abs(dchi) < 1e-9) break;
  }

  const f = 1 - (chi * chi * c2) / r0mag;
  const g = dtSec - (chi * chi * chi * c3) / sqrtMu;
  const gdot = 1 - (chi * chi * c2) / r;
  const fdot = (sqrtMu / (r * r0mag)) * chi * (psi * c3 - 1);

  const rNew: Vec3 = add(scale(r0, f), scale(v0, g));
  const vNew: Vec3 = add(scale(r0, fdot), scale(v0, gdot));

  return {
    epochMs: state.epochMs + dtSec * 1000,
    position: rNew,
    velocity: vNew,
  };
}

/** Specific orbital energy, for sanity checks. */
export function specificEnergy(state: StateVector): number {
  const r = norm(state.position);
  const v = norm(state.velocity);
  return (v * v) / 2 - MU_EARTH / r;
}

/** Cross-check helper used by tests: angular momentum vector magnitude. */
export function angularMomentum(state: StateVector): number {
  return norm(cross(state.position, state.velocity));
}

/** Difference of two states' positions (km). */
export function positionDelta(a: StateVector, b: StateVector): Vec3 {
  return sub(a.position, b.position);
}
