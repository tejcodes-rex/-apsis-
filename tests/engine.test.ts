import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCatalog } from "../lib/astro/catalog";
import { propagate, summarize, applyImpulse, tleEpochMs } from "../lib/astro/sgp4";
import { keplerPropagate, specificEnergy, angularMomentum } from "../lib/astro/kepler";
import { collisionProbability } from "../lib/conjunction/probability";
import { eciCovariance, ricSigmas } from "../lib/conjunction/covariance";
import { screenPrimary } from "../lib/conjunction/screening";
import { screenAllPairs } from "../lib/conjunction/sieve";
import { planAvoidance } from "../lib/maneuver/optimizer";
import { ricBasis } from "../lib/astro/frames";
import { norm, sub, dot, unit } from "../lib/astro/vec";
import type { Mat3 } from "../lib/math/matrix";
import type { SpaceObject, Vec3 } from "../lib/astro/types";

/** Local 3x3 * vec for the covariance-rotation reference test. */
function mat3Vec(M: Mat3, v: Vec3): Vec3 {
  return [
    M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
    M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
    M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
  ];
}

const raw = JSON.parse(
  readFileSync(join(process.cwd(), "public", "data", "catalog.json"), "utf8"),
);
const catalog = buildCatalog(raw);
const iss = catalog.objects.find((o) => o.tle.name.includes("ISS"))!;

describe("SGP4 propagation", () => {
  it("places the ISS in a plausible LEO orbit", () => {
    expect(iss).toBeTruthy();
    const orbit = summarize(iss.tle);
    expect(orbit.regime).toBe("LEO");
    expect(orbit.perigeeKm).toBeGreaterThan(350);
    expect(orbit.apogeeKm).toBeLessThan(470);
    expect(orbit.inclinationDeg).toBeGreaterThan(50);
    expect(orbit.inclinationDeg).toBeLessThan(53);
  });

  it("produces a finite state at the element epoch", () => {
    const st = propagate(iss.tle, tleEpochMs(iss.tle));
    expect(st).toBeTruthy();
    const r = norm(st!.position);
    expect(r).toBeGreaterThan(6600);
    expect(r).toBeLessThan(6900);
  });
});

describe("Two-body Kepler propagator", () => {
  const epoch = tleEpochMs(iss.tle);
  const st = propagate(iss.tle, epoch)!;

  it("conserves energy and angular momentum", () => {
    const e0 = specificEnergy(st);
    const h0 = angularMomentum(st);
    const later = keplerPropagate(st, 1800); // 30 min
    const e1 = specificEnergy(later);
    const h1 = angularMomentum(later);
    expect(Math.abs((e1 - e0) / e0)).toBeLessThan(1e-6);
    expect(Math.abs((h1 - h0) / h0)).toBeLessThan(1e-6);
  });

  it("returns to the start after one full (osculating) period", () => {
    // Use the two-body period implied by the osculating energy of THIS state,
    // not the SGP4 mean-motion period (which differs by the perturbation model).
    const MU = 398600.8;
    const a = -MU / (2 * specificEnergy(st));
    const periodSec = 2 * Math.PI * Math.sqrt((a * a * a) / MU);
    const back = keplerPropagate(st, periodSec);
    const drift = norm(sub(back.position, st.position));
    // Pure two-body closure should return to within metres over one revolution.
    expect(drift).toBeLessThan(0.05);
  });
});

describe("Foster collision probability", () => {
  const cov: Mat3 = [
    0.25, 0, 0,
    0, 0.25, 0,
    0, 0, 0.25,
  ]; // 0.5 km isotropic sigma

  it("is near zero for a far miss and decreases with distance", () => {
    const v: [number, number, number] = [0, 7.5, 0];
    const near = collisionProbability([0.05, 0, 0], v, cov, 0.01).pc;
    const far = collisionProbability([5, 0, 0], v, cov, 0.01).pc;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeLessThan(1e-6);
  });

  it("rises as the miss shrinks below one sigma", () => {
    const v: [number, number, number] = [0, 7.5, 0];
    const tight = collisionProbability([0.1, 0, 0], v, cov, 0.02).pc;
    const looser = collisionProbability([0.4, 0, 0], v, cov, 0.02).pc;
    expect(tight).toBeGreaterThan(looser);
    expect(tight).toBeGreaterThan(0);
  });
});

describe("Covariance model", () => {
  it("grows position uncertainty with element age", () => {
    const epoch = tleEpochMs(iss.tle);
    const st = propagate(iss.tle, epoch)!;
    const young = eciCovariance(st, { ageDays: 0.1, regime: "LEO" });
    const old = eciCovariance(st, { ageDays: 5, regime: "LEO" });
    const trace = (m: Mat3) => m[0] + m[4] + m[8];
    expect(trace(old)).toBeGreaterThan(trace(young));
  });
});

describe("Foster Pc reference value", () => {
  it("matches the closed form for an isotropic, centered encounter", () => {
    // For an isotropic 2D Gaussian centered on the hard-body disk, the closed
    // form is Pc = 1 - exp(-R^2 / (2 sigma^2)). This pins the absolute value of
    // the quadrature, not just its ordering.
    const sigma = 0.5; // km
    const cov: Mat3 = [sigma * sigma, 0, 0, 0, sigma * sigma, 0, 0, 0, sigma * sigma];
    const R = 0.3; // km hard-body radius
    const { pc } = collisionProbability([0, 0, 0], [0, 7.5, 0], cov, R);
    const expected = 1 - Math.exp(-(R * R) / (2 * sigma * sigma));
    expect(Math.abs(pc - expected)).toBeLessThan(0.005);
  });
});

describe("Covariance rotation correctness", () => {
  it("places the dominant uncertainty axis exactly along in-track in ECI", () => {
    // C_eci = Bᵀ diag(σ²) B must have the in-track unit vector as the eigenvector
    // for the largest (in-track) eigenvalue. This is the single most attackable
    // line of the covariance math, so verify C·I = σ_i² · I directly.
    const epoch = tleEpochMs(iss.tle);
    const st = propagate(iss.tle, epoch)!;
    const input = { ageDays: 1, regime: "LEO" as const };
    const cov = eciCovariance(st, input);
    const { I } = ricBasis(st);
    const { si } = ricSigmas(input);
    const Cv = mat3Vec(cov, I);
    // C·I is parallel to I (eigenvector) ...
    expect(Math.abs(dot(unit(Cv), I) - 1)).toBeLessThan(1e-9);
    // ... with eigenvalue σ_i².
    expect(Math.abs(norm(Cv) - si * si) / (si * si)).toBeLessThan(1e-6);
  });
});

describe("End-to-end: real hypervelocity conjunction + autonomous maneuver", () => {
  const primary = catalog.objects.find((o) => o.tle.name.includes("QIANFAN-168"));
  const secondary = catalog.objects.find((o) => o.tle.name === "FENGYUN 1C");

  it("has both real objects in the bundled catalog", () => {
    expect(primary).toBeTruthy();
    expect(secondary).toBeTruthy();
  });

  it("screens the real conjunction and the planner reduces a valid Foster Pc", () => {
    if (!primary || !secondary) return;
    const nowMs = Math.min(tleEpochMs(primary.tle), tleEpochMs(secondary.tle)) - 3600_000;
    const conjunctions = screenPrimary(primary, [primary, secondary], nowMs, {
      windowHours: 72,
      gateKm: 25,
    });
    const conj = conjunctions.find((c) => c.secondaryId === secondary.tle.noradId);
    expect(conj).toBeTruthy();
    expect(conj!.fosterValid).toBe(true);
    expect(conj!.relativeSpeedKmps).toBeGreaterThan(7);
    expect(conj!.pc).toBeGreaterThan(1e-5);

    const plan = planAvoidance(primary, secondary, conj!, nowMs, { targetPc: conj!.pc / 100 });
    expect(plan).toBeTruthy();
    expect(plan!.pcAfter).toBeLessThanOrEqual(conj!.pc);
    expect(plan!.missAfterKm).toBeGreaterThan(conj!.missKm);
    expect(plan!.deltaVmagMps).toBeGreaterThan(0);
  });

  it("the all-pairs sieve also finds the real conjunction (not just the marcher path)", () => {
    if (!primary || !secondary) return;
    // A small set: the two objects plus nearby-altitude neighbours, so the
    // spatial-hash sieve runs fast but still has a realistic binning set.
    const targetAlt = (primary.orbit.apogeeKm + primary.orbit.perigeeKm) / 2;
    const neighbours = catalog.objects
      .filter((o) => o.orbit.regime === "LEO" && o.tle.noradId !== primary.tle.noradId && o.tle.noradId !== secondary.tle.noradId)
      .map((o) => ({ o, d: Math.abs((o.orbit.apogeeKm + o.orbit.perigeeKm) / 2 - targetAlt) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 40)
      .map((x) => x.o);
    const set = [primary, secondary, ...neighbours];
    // Locate the real TCA via the marcher path, then run the sieve over a tight
    // window around it: this isolates the sieve's binning + refinement (fast) and
    // proves it finds the same conjunction the direct marcher does.
    const anchor = Math.min(tleEpochMs(primary.tle), tleEpochMs(secondary.tle)) - 3600_000;
    const direct = screenPrimary(primary, [primary, secondary], anchor, { windowHours: 72, gateKm: 25 });
    const known = direct.find((c) => c.secondaryId === secondary.tle.noradId)!;
    expect(known).toBeTruthy();
    const found = screenAllPairs(set, known.tcaMs - 3600_000, {
      windowHours: 2,
      gateKm: 8,
      stepSec: 18,
    });
    const pair = found.find(
      (c) =>
        (c.primaryId === primary.tle.noradId && c.secondaryId === secondary.tle.noradId) ||
        (c.primaryId === secondary.tle.noradId && c.secondaryId === primary.tle.noradId),
    );
    expect(pair).toBeTruthy();
    expect(pair!.fosterValid).toBe(true);
    expect(pair!.relativeSpeedKmps).toBeGreaterThan(7);
  }, 30000);

  it("flags a slow co-orbital pair as not a Foster collision case and refuses to maneuver", () => {
    // Clone the ISS with a tiny along-track phase offset: a co-orbital trail with
    // near-zero relative speed. The engine must mark this Foster-invalid and the
    // planner must decline it rather than report a meaningless avoidance burn.
    const l2 = iss.tle.line2;
    const ma = parseFloat(l2.slice(43, 51));
    const newMa = ((ma + 0.03) % 360 + 360) % 360;
    const newL2 = (l2.slice(0, 43) + newMa.toFixed(4).padStart(8, " ") + l2.slice(51));
    const l1b = iss.tle.line1.slice(0, 2) + "99999" + iss.tle.line1.slice(7);
    const l2b = newL2.slice(0, 2) + "99999" + newL2.slice(7);
    const target: SpaceObject = {
      tle: { ...iss.tle, noradId: 99999, name: "DRILL TARGET", line1: l1b, line2: l2b },
      orbit: summarize({ ...iss.tle, line1: l1b, line2: l2b }),
    };
    const epoch = tleEpochMs(iss.tle);
    const conjunctions = screenPrimary(iss, [iss, target], epoch, { windowHours: 2, gateKm: 50 });
    expect(conjunctions.length).toBeGreaterThan(0);
    const c = conjunctions[0];
    expect(c.relativeSpeedKmps).toBeLessThan(0.5);
    expect(c.fosterValid).toBe(false);
    expect(c.severity).toBe("INFO");
    expect(planAvoidance(iss, target, c, epoch)).toBeNull();
  });
});
