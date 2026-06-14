/**
 * Core domain types shared across the astrodynamics, conjunction, and maneuver
 * modules. Vectors are plain [x, y, z] tuples in kilometres (position) or
 * kilometres/second (velocity), expressed in the TEME/ECI frame unless a field
 * name says otherwise.
 */

export type Vec3 = [number, number, number];

/** A Two-Line Element set plus the metadata we carry alongside it. */
export interface TLE {
  /** NORAD catalog id. */
  noradId: number;
  /** Object name from the catalog header line (line 0). */
  name: string;
  line1: string;
  line2: string;
  /** Coarse object class derived from name/orbit for filtering and colour. */
  type: ObjectType;
  /** Operator/country tag when known, else "UNKNOWN". */
  operator?: string;
}

export type ObjectType =
  | "PAYLOAD"
  | "ROCKET_BODY"
  | "DEBRIS"
  | "UNKNOWN";

/** A propagated state at a single instant. */
export interface StateVector {
  /** Milliseconds since Unix epoch (UTC). */
  epochMs: number;
  position: Vec3; // km, TEME/ECI
  velocity: Vec3; // km/s, TEME/ECI
}

/** Derived classical-ish orbit summary for UI and filtering. */
export interface OrbitSummary {
  apogeeKm: number; // altitude above mean Earth radius
  perigeeKm: number;
  inclinationDeg: number;
  periodMin: number;
  /** Coarse regime bucket. */
  regime: "LEO" | "MEO" | "GEO" | "HEO";
}

/** A propagated object: identity + cached orbit summary. */
export interface SpaceObject {
  tle: TLE;
  orbit: OrbitSummary;
}

/** One screened close approach between two catalog objects. */
export interface Conjunction {
  primaryId: number;
  secondaryId: number;
  primaryName: string;
  secondaryName: string;
  /** Time of closest approach, ms since epoch (UTC). */
  tcaMs: number;
  /** Miss distance at TCA, km. */
  missKm: number;
  /** Relative speed at TCA, km/s. */
  relativeSpeedKmps: number;
  /** Combined hard-body radius used in the Pc integral, km. */
  hardBodyRadiusKm: number;
  /** Collision probability at TCA (2D Foster method). */
  pc: number;
  /**
   * Whether the Foster 2D model applies (relative speed high enough for a short,
   * straight-line encounter). False for slow co-orbital pairs, where `pc` is not
   * physically meaningful and must not be used for ranking or alerting.
   */
  fosterValid: boolean;
  /** Severity bucket derived from pc. */
  severity: Severity;
}

export type Severity = "INFO" | "WATCH" | "WARNING" | "CRITICAL";

/** A planned avoidance maneuver for the primary object. */
export interface Maneuver {
  conjunction: Conjunction;
  /** Lead time before TCA at which the burn is applied, seconds. */
  leadTimeSec: number;
  /** Delta-V components in the RIC (radial/in-track/cross-track) frame, m/s. */
  deltaVricMps: Vec3;
  /** Delta-V magnitude, m/s. */
  deltaVmagMps: number;
  /** Collision probability after the maneuver. */
  pcAfter: number;
  /** Miss distance after the maneuver, km. */
  missAfterKm: number;
  /** Approximate propellant cost for a reference 500 kg / 220 s Isp bus, kg. */
  propellantKg: number;
  /** Human-readable rationale produced by the decision layer. */
  rationale: string;
}
