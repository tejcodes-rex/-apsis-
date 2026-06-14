/**
 * Brutal empirical stress harness. Runs the real engine across the entire
 * catalog and every orbital regime, hunting for NaN/Infinity, out-of-range
 * probabilities, crashes, and maneuver claims that do not hold up under an
 * independent re-propagation. Exits non-zero if anything is wrong.
 *
 * Run: npx tsx scripts/stress.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCatalog } from "../lib/astro/catalog";
import { propagate, tleEpochMs, applyImpulse } from "../lib/astro/sgp4";
import { keplerPropagate, specificEnergy, angularMomentum } from "../lib/astro/kepler";
import { ricToEci } from "../lib/astro/frames";
import { collisionProbability, covarianceEllipse } from "../lib/conjunction/probability";
import { screenPrimary } from "../lib/conjunction/screening";
import { planAvoidance } from "../lib/maneuver/optimizer";
import { norm, sub, add } from "../lib/astro/vec";
import type { Mat3 } from "../lib/math/matrix";
import type { SpaceObject, Vec3 } from "../lib/astro/types";

const raw = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "catalog.json"), "utf8"));
const catalog = buildCatalog(raw);

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  FAIL: ${msg}`);
  }
}
const finite = (v: Vec3) => v.every((x) => Number.isFinite(x));

// 1) Propagate EVERY object at several times; positions must be finite and sane.
console.log("[1] Propagating full catalog at epoch, +1h, +1d, +7d...");
{
  const base = Math.max(...catalog.objects.slice(0, 50).map((o) => tleEpochMs(o.tle)));
  let propFail = 0;
  let nullCount = 0;
  for (const o of catalog.objects) {
    for (const dtH of [0, 1, 24, 168]) {
      const st = propagate(o.tle, base + dtH * 3600_000);
      if (!st) {
        nullCount++;
        continue;
      }
      const r = norm(st.position);
      // Any state the propagator returns must now be physically plausible
      // (the propagator drops decayed/diverged states to null itself).
      if (!finite(st.position) || !finite(st.velocity) || r < 6200 || r > 600000) propFail++;
    }
  }
  check(propFail === 0, `${propFail} propagations produced non-finite/insane states`);
  console.log(`    ${catalog.objects.length} objects, ${nullCount} SGP4 nulls (expected for decayed), ${propFail} bad`);
}

// 2) Screen a diverse sample of primaries across regimes; all Pc in [0,1], finite.
console.log("[2] Screening diverse primaries across regimes...");
{
  const byRegime: Record<string, SpaceObject[]> = { LEO: [], MEO: [], GEO: [], HEO: [] };
  for (const o of catalog.objects) byRegime[o.orbit.regime]?.push(o);
  const sample: SpaceObject[] = [];
  for (const r of ["LEO", "MEO", "GEO", "HEO"]) {
    const arr = byRegime[r];
    for (let i = 0; i < Math.min(8, arr.length); i++) sample.push(arr[Math.floor((i * arr.length) / 8)]);
  }
  const now = Math.max(...sample.map((o) => tleEpochMs(o.tle)));
  let badPc = 0;
  let total = 0;
  for (const p of sample) {
    const cs = screenPrimary(p, catalog.objects, now, { windowHours: 24, gateKm: 25, maxCandidates: 1500 });
    for (const c of cs) {
      total++;
      if (!Number.isFinite(c.pc) || c.pc < 0 || c.pc > 1) badPc++;
      if (!Number.isFinite(c.missKm) || c.missKm < 0) badPc++;
      if (!Number.isFinite(c.relativeSpeedKmps)) badPc++;
      if (c.fosterValid && c.relativeSpeedKmps < 0.5) badPc++; // gate consistency
      if (!c.fosterValid && c.severity !== "INFO") badPc++;
    }
  }
  check(badPc === 0, `${badPc} bad conjunction records out of ${total}`);
  console.log(`    ${sample.length} primaries, ${total} conjunctions, ${badPc} bad`);
}

// 3) Independently verify maneuver claims: re-propagate and confirm the burn
//    actually widens the miss vs the un-maneuvered case at the reported TCA.
console.log("[3] Independently verifying autonomous maneuvers...");
{
  // Use the known real hypervelocity conjunction.
  const primary = catalog.objects.find((o) => o.tle.name.includes("QIANFAN-168"));
  const secondary = catalog.objects.find((o) => o.tle.name === "FENGYUN 1C");
  if (primary && secondary) {
    const now = Math.min(tleEpochMs(primary.tle), tleEpochMs(secondary.tle)) - 3600_000;
    const cs = screenPrimary(primary, [primary, secondary], now, { windowHours: 72, gateKm: 25 });
    const conj = cs.find((c) => c.secondaryId === secondary.tle.noradId);
    check(!!conj, "real conjunction not found");
    if (conj) {
      const plan = planAvoidance(primary, secondary, conj, now, { targetPc: conj.pc / 100 });
      check(!!plan, "planner returned null for actionable conjunction");
      if (plan) {
        // Independent re-propagation of the maneuvered miss at the reported tcaMs.
        const burnMs = conj.tcaMs - plan.leadTimeSec * 1000;
        const burnState = propagate(primary.tle, burnMs)!;
        const dvEci = ricToEci(
          [plan.deltaVricMps[0] / 1000, plan.deltaVricMps[1] / 1000, plan.deltaVricMps[2] / 1000],
          burnState,
        );
        const maneuvered = applyImpulse(burnState, dvEci);
        // Independent miss scan around TCA.
        let bestMan = Infinity;
        let bestNom = Infinity;
        for (let dt = -120; dt <= 120; dt += 5) {
          const t = conj.tcaMs + dt * 1000;
          const arc = (t - burnMs) / 1000;
          if (arc <= 0) continue;
          const man = keplerPropagate(maneuvered, arc);
          const ref = keplerPropagate(burnState, arc);
          const diff = sub(man.position, ref.position);
          const pSg = propagate(primary.tle, t)!;
          const sSg = propagate(secondary.tle, t)!;
          bestNom = Math.min(bestNom, norm(sub(sSg.position, pSg.position)));
          bestMan = Math.min(bestMan, norm(sub(sSg.position, add(pSg.position, diff))));
        }
        // The burn must widen the miss MEANINGFULLY (independently re-propagated),
        // reduce probability, and the reported post-burn miss must agree with this
        // independent recomputation to within a tolerance.
        check(bestMan > bestNom * 2, `maneuver widening too small (nom ${bestNom.toFixed(3)} -> man ${bestMan.toFixed(3)} km)`);
        check(plan.pcAfter < conj.pc, "pcAfter not strictly below pc");
        check(plan.pcAfter <= 1e-5, `pcAfter ${plan.pcAfter.toExponential(2)} not below safe line`);
        const missAgreement = Math.abs(bestMan - plan.missAfterKm) / plan.missAfterKm;
        check(missAgreement < 0.25, `reported missAfter ${plan.missAfterKm.toFixed(2)} disagrees with independent ${bestMan.toFixed(2)} km`);
        console.log(`    nominal miss ${bestNom.toFixed(3)} km -> maneuvered ${bestMan.toFixed(3)} km (reported ${plan.missAfterKm.toFixed(3)}), dv ${(plan.deltaVmagMps*100).toFixed(1)} cm/s, pcAfter ${plan.pcAfter.toExponential(2)}`);
      }
    }
  }
}

// 4) Degenerate / adversarial inputs to the probability core.
console.log("[4] Degenerate inputs to collisionProbability...");
{
  const iso: Mat3 = [0.25, 0, 0, 0, 0.25, 0, 0, 0, 0.25];
  const cases: [Vec3, Vec3, Mat3, number, string][] = [
    [[0, 0, 0], [0, 7.5, 0], iso, 0.01, "zero miss"],
    [[1000, 0, 0], [0, 7.5, 0], iso, 0.01, "huge miss"],
    [[0.1, 0, 0], [0, 0, 0], iso, 0.01, "zero relative velocity"],
    [[0.1, 0, 0], [0, 7.5, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], 0.01, "zero covariance"],
    [[0.1, 0, 0], [0, 7.5, 0], iso, 0, "zero hard-body"],
    [[0.1, 0.1, 0.1], [1e-6, 7.5, 0], iso, 1e3, "hard-body larger than miss"],
  ];
  for (const [r, v, c, hbr, name] of cases) {
    const res = collisionProbability(r, v, c, hbr);
    check(Number.isFinite(res.pc) && res.pc >= 0 && res.pc <= 1, `pc not in [0,1] for "${name}" (got ${res.pc})`);
    const ell = covarianceEllipse(res.c2);
    check(Number.isFinite(ell.major) && Number.isFinite(ell.minor) && Number.isFinite(ell.angleRad), `ellipse non-finite for "${name}"`);
  }
}

// 5) Kepler propagator on eccentric / extreme cases.
console.log("[5] Kepler propagator on eccentric and extreme arcs...");
{
  // Highly eccentric and high/low orbits from the catalog.
  const ecc = catalog.objects
    .filter((o) => o.orbit.regime === "HEO" || o.orbit.apogeeKm - o.orbit.perigeeKm > 5000)
    .slice(0, 30);
  let bad = 0;
  for (const o of ecc) {
    const st = propagate(o.tle, tleEpochMs(o.tle));
    if (!st) continue;
    const e0 = specificEnergy(st);
    const h0 = angularMomentum(st);
    for (const dt of [60, 3600, 21600, -3600]) {
      const s2 = keplerPropagate(st, dt);
      if (!finite(s2.position) || !finite(s2.velocity)) bad++;
      const e1 = specificEnergy(s2);
      const h1 = angularMomentum(s2);
      if (Math.abs((e1 - e0) / e0) > 1e-4 || Math.abs((h1 - h0) / h0) > 1e-4) bad++;
    }
  }
  check(bad === 0, `${bad} eccentric Kepler propagations failed finiteness/conservation`);
  console.log(`    ${ecc.length} eccentric/HEO objects exercised`);
}

console.log(`\n${checks} checks, ${failures} failures.`);
process.exit(failures === 0 ? 0 : 1);
