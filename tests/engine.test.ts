import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCatalog } from "../lib/astro/catalog";
import { propagate, summarize, applyImpulse, tleEpochMs } from "../lib/astro/sgp4";
import { keplerPropagate, specificEnergy, angularMomentum } from "../lib/astro/kepler";
import { collisionProbability } from "../lib/conjunction/probability";
import { eciCovariance } from "../lib/conjunction/covariance";
import { screenPrimary } from "../lib/conjunction/screening";
import { planAvoidance } from "../lib/maneuver/optimizer";
import { norm, sub } from "../lib/astro/vec";
import type { Mat3 } from "../lib/math/matrix";
import type { SpaceObject } from "../lib/astro/types";

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

describe("End-to-end: screening + autonomous maneuver", () => {
  // Build a guaranteed close approach by cloning the ISS orbit with a small
  // along-track phase offset (a co-orbital lead/trail). This is a real, valid
  // SGP4 scenario that exercises the full screen -> probability -> plan pipeline.
  function clonePhaseOffset(base: SpaceObject, meanAnomalyDeltaDeg: number): SpaceObject {
    // Mean anomaly occupies columns 44-51 (0-indexed 43-51) of TLE line 2.
    const l2 = base.tle.line2;
    const maStr = l2.slice(43, 51);
    const ma = parseFloat(maStr);
    let newMa = (ma + meanAnomalyDeltaDeg) % 360;
    if (newMa < 0) newMa += 360;
    const newMaStr = newMa.toFixed(4).padStart(8, " ");
    const newL2 = l2.slice(0, 43) + newMaStr + l2.slice(51);
    // Give it a distinct NORAD id so the screen treats it as a separate object.
    const newL1 = base.tle.line1.slice(0, 2) + "99999" + base.tle.line1.slice(7);
    const newL2b = newL2.slice(0, 2) + "99999" + newL2.slice(7);
    return {
      tle: {
        ...base.tle,
        noradId: 99999,
        name: "DRILL TARGET",
        line1: newL1,
        line2: newL2b,
      },
      orbit: summarize({ ...base.tle, line1: newL1, line2: newL2b }),
    };
  }

  it("finds the conjunction and the planner reduces collision probability", () => {
    const epoch = tleEpochMs(iss.tle);
    // ~0.03 deg phase offset => a few km along-track separation.
    const target = clonePhaseOffset(iss, 0.03);
    const conjunctions = screenPrimary(iss, [iss, target], epoch, {
      windowHours: 2,
      gateKm: 50,
    });
    expect(conjunctions.length).toBeGreaterThan(0);
    const top = conjunctions[0];
    expect(top.missKm).toBeLessThan(50);
    expect(top.pc).toBeGreaterThan(0);

    const plan = planAvoidance(iss, target, top, epoch, { targetPc: top.pc / 100 });
    expect(plan).toBeTruthy();
    expect(plan!.pcAfter).toBeLessThanOrEqual(top.pc);
    expect(plan!.missAfterKm).toBeGreaterThan(top.missKm);
    expect(plan!.deltaVmagMps).toBeGreaterThan(0);
  });
});
