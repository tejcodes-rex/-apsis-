/**
 * Physical and astrodynamic constants.
 * Values follow the WGS-72 model used internally by SGP4, so that quantities we
 * derive here stay consistent with the propagator rather than mixing reference
 * frames. Where a more modern WGS-84 value is conventional (e.g. rendering), it
 * is named explicitly.
 */

/** Earth gravitational parameter, km^3 / s^2 (WGS-72). */
export const MU_EARTH = 398600.8;

/** Earth equatorial radius, km (WGS-72). */
export const R_EARTH = 6378.135;

/** Earth equatorial radius, km (WGS-84), used for geodetic/render math. */
export const R_EARTH_WGS84 = 6378.137;

/** Earth flattening (WGS-84). */
export const F_EARTH = 1 / 298.257223563;

/** Sidereal rotation rate of Earth, rad / s. */
export const OMEGA_EARTH = 7.292115e-5;

/** Seconds in a solar day. */
export const SECONDS_PER_DAY = 86400;

/** Standard J2 zonal harmonic (dimensionless). */
export const J2 = 1.082616e-3;

/** Convert degrees to radians. */
export const DEG2RAD = Math.PI / 180;

/** Convert radians to degrees. */
export const RAD2DEG = 180 / Math.PI;

/**
 * Operational collision-probability threshold. A widely used industry red line
 * for crewed and high-value assets is 1e-4; we surface anything above 1e-7 for
 * situational awareness and trigger autonomous response above the red line.
 */
export const PC_ALERT_THRESHOLD = 1e-7;
export const PC_ACTION_THRESHOLD = 1e-4;

/**
 * Minimum relative speed for the Foster 2D model to apply, km/s. Foster assumes
 * a short, effectively straight-line encounter so the geometry collapses onto a
 * static 2D Gaussian in the encounter plane. Below this speed the pair is
 * co-orbital (formation flying / station-keeping), the encounter is long, the
 * relative trajectory curves through the covariance, and a 2D Foster Pc is not
 * physically meaningful. We flag those rather than report a misleading number.
 */
export const MIN_FOSTER_REL_SPEED_KMPS = 0.5;

/** Screening volume gate: only refine pairs whose coarse miss is below this, km. */
export const SCREENING_DISTANCE_GATE_KM = 25;
