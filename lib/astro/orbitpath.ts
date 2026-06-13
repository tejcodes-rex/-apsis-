/**
 * Sample full orbit and trajectory paths for 3D rendering. These run on the main
 * thread (only a few hundred points each, recomputed on selection) and reuse the
 * exact same propagators as the analysis engine so the lines drawn match the
 * physics being reported.
 */
import { ricToEci } from "./frames";
import { keplerPropagate } from "./kepler";
import { applyImpulse, propagate } from "./sgp4";
import type { SpaceObject, StateVector, Vec3 } from "./types";

/** Sample one full orbital revolution of an object as ECI points (km). */
export function sampleOrbit(obj: SpaceObject, startMs: number, samples = 256): Float32Array {
  const periodMs = obj.orbit.periodMin * 60_000;
  const out = new Float32Array(samples * 3);
  for (let i = 0; i < samples; i++) {
    const t = startMs + (periodMs * i) / (samples - 1);
    const st = propagate(obj.tle, t);
    if (st) {
      out[i * 3] = st.position[0];
      out[i * 3 + 1] = st.position[1];
      out[i * 3 + 2] = st.position[2];
    }
  }
  return out;
}

/**
 * Sample the post-maneuver trajectory of the primary: SGP4 up to the burn, then
 * the two-body propagation of the post-burn state. Returns ECI points (km) for a
 * line that visibly diverges from the nominal track after the burn.
 */
export function sampleManeuveredArc(
  primary: SpaceObject,
  burnMs: number,
  dvRicMps: Vec3,
  durationSec: number,
  samples = 200,
): Float32Array {
  const burnState = propagate(primary.tle, burnMs);
  const out = new Float32Array(samples * 3);
  if (!burnState) return out;
  const dvEci: Vec3 = ricToEci(
    [dvRicMps[0] / 1000, dvRicMps[1] / 1000, dvRicMps[2] / 1000],
    burnState,
  );
  const maneuvered: StateVector = applyImpulse(burnState, dvEci);
  for (let i = 0; i < samples; i++) {
    const dt = (durationSec * i) / (samples - 1);
    const st = keplerPropagate(maneuvered, dt);
    out[i * 3] = st.position[0];
    out[i * 3 + 1] = st.position[1];
    out[i * 3 + 2] = st.position[2];
  }
  return out;
}
