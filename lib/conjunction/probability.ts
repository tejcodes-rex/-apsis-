/**
 * Collision probability via Foster's 2D method (the de-facto industry standard
 * for short-encounter conjunctions, used by NASA CARA and ESA).
 *
 * Idea: during a close approach the relative motion is, to first order, a
 * straight line. We collapse the 3D geometry onto the 2D "encounter plane"
 * perpendicular to the relative velocity at the time of closest approach. The
 * combined position covariance of both objects projects into that plane as a 2D
 * Gaussian; a collision is the event that the relative position falls inside the
 * combined hard-body disk. Pc is therefore the integral of that 2D Gaussian over
 * a disk of radius = combined hard-body radius, centred on the projected miss.
 *
 * We evaluate the integral by direct polar quadrature, which is exact in the
 * limit of fine sampling and avoids the convergence caveats of the analytic
 * (Chan) series for the wide range of geometries in a real catalog.
 */
import type { Mat3 } from "../math/matrix";
import { inv2, type Mat2 } from "../math/matrix";
import type { Vec3 } from "../astro/types";
import { cross, dot, scale, sub, unit, norm } from "../astro/vec";

/** 3x3 matrix times 3-vector. */
function mat3Vec(M: Mat3, v: Vec3): Vec3 {
  return [
    M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
    M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
    M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
  ];
}

/** Pick any unit vector perpendicular to n (for the degenerate zero-miss case). */
function anyPerp(n: Vec3): Vec3 {
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(n, ref));
}

export interface PcResult {
  pc: number;
  /** Projected miss in the encounter plane, km. */
  missPlaneKm: number;
  /** Mahalanobis-style ratio of miss to combined 1-sigma (smaller = riskier). */
  sigmaRatio: number;
}

/**
 * Compute collision probability.
 * @param rRelEci  relative position (secondary - primary) at TCA, km, ECI
 * @param vRelEci  relative velocity (secondary - primary) at TCA, km/s, ECI
 * @param covEci   combined position covariance (primary + secondary), km^2, ECI
 * @param hbrKm    combined hard-body radius, km
 */
export function collisionProbability(
  rRelEci: Vec3,
  vRelEci: Vec3,
  covEci: Mat3,
  hbrKm: number,
): PcResult {
  const uv = unit(vRelEci);
  // Projection of relative position into the encounter plane (remove the part
  // along the relative velocity).
  const along = dot(rRelEci, uv);
  const proj = sub(rRelEci, scale(uv, along));
  const xi = norm(proj) > 1e-9 ? unit(proj) : anyPerp(uv);
  const eta = unit(cross(uv, xi));

  // Project the combined covariance into the plane: C2 = P C Pᵀ.
  const Cxi = mat3Vec(covEci, xi);
  const Ceta = mat3Vec(covEci, eta);
  let C2: Mat2 = [dot(xi, Cxi), dot(xi, Ceta), dot(eta, Cxi), dot(eta, Ceta)];
  // Symmetrise and add a small floor to keep the integral well-conditioned.
  const sym = (C2[1] + C2[2]) / 2;
  const floor = 1e-8; // km^2 (~0.1 m) numerical floor
  C2 = [C2[0] + floor, sym, sym, C2[3] + floor];

  const Cinv = inv2(C2);
  if (!Cinv) return { pc: 0, missPlaneKm: norm(proj), sigmaRatio: Infinity };
  const detC = C2[0] * C2[3] - C2[1] * C2[2];
  const normConst = 1 / (2 * Math.PI * Math.sqrt(Math.max(detC, 1e-300)));

  // Projected miss vector in (xi, eta) coordinates.
  const m: [number, number] = [dot(rRelEci, xi), dot(rRelEci, eta)];
  const missPlaneKm = Math.hypot(m[0], m[1]);

  // Polar quadrature of the Gaussian over the hard-body disk centred at origin.
  // The integrand is N(x; m, C2); we integrate x over |x| <= hbr.
  const NR = 48;
  const NTH = 72;
  let pc = 0;
  for (let i = 0; i < NR; i++) {
    const rho = (hbrKm * (i + 0.5)) / NR;
    const dRho = hbrKm / NR;
    for (let j = 0; j < NTH; j++) {
      const th = (2 * Math.PI * (j + 0.5)) / NTH;
      const x = rho * Math.cos(th) - m[0];
      const y = rho * Math.sin(th) - m[1];
      // exponent = -0.5 xᵀ Cinv x
      const e =
        -0.5 * (Cinv[0] * x * x + (Cinv[1] + Cinv[2]) * x * y + Cinv[3] * y * y);
      const dens = normConst * Math.exp(e);
      pc += dens * rho * dRho * ((2 * Math.PI) / NTH); // dA = rho dRho dTheta
    }
  }
  pc = Math.min(1, Math.max(0, pc));

  // sigmaRatio: miss distance in units of the larger principal sigma.
  const sigMax = Math.sqrt(Math.max(C2[0], C2[3]));
  const sigmaRatio = sigMax > 0 ? missPlaneKm / sigMax : Infinity;

  return { pc, missPlaneKm, sigmaRatio };
}
