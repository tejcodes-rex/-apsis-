# The science behind APSIS

This document explains the algorithms APSIS runs and, just as importantly, the
assumptions they rest on. Everything here maps to code in `lib/`, and the engine
test suite (`tests/engine.test.ts`) checks the parts that have a known answer.

## 1. Propagation

Each object is described by a Two-Line Element set. We propagate with **SGP4/SDP4**
(via `satellite.js`), the analytic model TLEs are defined against, using anything
else with TLE inputs introduces error larger than the perturbations it adds. SGP4
returns position and velocity in the TEME frame, which we treat as ECI for the short
encounter timescales involved.

Orbit summaries (apogee, perigee, inclination, period, regime) are derived directly
from the SGP4 mean elements: with mean motion `n` (rad/s), the semi-major axis is
`a = (μ / n²)^(1/3)`, and apsides follow from `a(1 ± e)`.

## 2. Conjunction screening

Screening one asset against a full catalog naively costs one fine time search per
object. We cut that down in stages:

1. **Geometric sieve** (`screening.ts`). Two objects can only approach within the
   gate if their radial shells `[r_perigee, r_apogee]` overlap within the gate. This
   O(1) test eliminates most of the catalog instantly.
2. **Adaptive-step march** (`tca.ts`). For survivors we march the relative distance
   with a step bounded by `(d − gate) / v_rel`. Far apart, the step is large; as the
   pair nears the gate the step shrinks smoothly, so a fast crossing cannot slip
   between samples the way a fixed coarse step would allow.
3. **Golden-section refinement.** Each detected dip is minimised to sub-second TCA.

For whole-catalog, all-pairs screening (`sieve.ts`) we use a **spatial-hash "cube"
filter**: bin every propagated position into a 3D grid at each time sample and only
consider pairs that share a neighbourhood sized to `gate + v·Δt`. This is the
technique real catalogs use to make all-pairs screening near-linear.

## 3. Collision probability (Foster 2D)

Given the geometry at TCA we compute the probability the two objects actually collide,
using **Foster's 2D method** (`probability.ts`), the operational standard at NASA CARA
and ESA.

- During a short encounter, relative motion is approximately linear, so we collapse
  the problem onto the 2D **encounter plane** perpendicular to the relative velocity.
  This assumption only holds at high relative speed, so APSIS gates Foster Pc on
  relative speed (`MIN_FOSTER_REL_SPEED_KMPS`): slow co-orbital pairs (formation
  flying, station-keeping) are flagged "Foster N/A" rather than given a meaningless
  2D probability, and they never raise an alert.
- The combined position covariance projects into that plane as a 2×2 Gaussian.
- A collision is the event that the relative position lands inside the combined
  hard-body disk, so

  `Pc = ∬_{|x| ≤ R_HB}  N(x; μ, C₂) dx`

  where `μ` is the projected miss vector and `C₂` the in-plane covariance. We evaluate
  the integral by direct polar quadrature, which is exact in the fine-sampling limit
  and avoids the convergence caveats of the analytic (Chan) series across the wide
  range of geometries in a real catalog.

### Covariance, the honest part

TLE/GP data ships **no covariance**, yet Pc is meaningless without one. APSIS uses a
documented, replaceable model (`covariance.ts`): a diagonal covariance in each object's
RIC frame whose **in-track** axis dominates and whose every axis grows with the **age
of the element set**, rotated into ECI as `C = Bᵀ diag(σ²) B`. The numbers are
deliberately conservative and shown in the UI. Feeding operator/OD covariance (a CDM)
in place of this model is a one-function change and is the first Round 2 upgrade.

Hard-body radii are per-class envelopes (payload ≈ 5 m, rocket body ≈ 8 m, debris ≈ 1 m)
because the catalog carries no dimensions. Both the live screen and the global sieve
use the same model so their probabilities agree.

## 4. Autonomous avoidance maneuver

When Pc crosses the action line, the planner (`maneuver/optimizer.ts`) searches the
maneuver design space:

- **Direction:** in-track. An along-track impulse changes the period, so the along-track
  separation grows roughly linearly with lead time, the minimum-energy way to open a
  miss distance.
- **Lead time:** candidate burns from half an orbit up to several orbits before TCA.
  More lead means a smaller burn.
- **Magnitude:** for each lead time we bisect for the smallest Δv that drives Pc below
  the safe target.

The subtlety is fidelity. SGP4 cannot continue from an arbitrary post-burn state, so we
propagate the post-burn arc with a **universal-variable two-body solver**
(`astro/kepler.ts`). To avoid trusting two-body motion as truth, we propagate **both** a
maneuvered and an un-maneuvered copy and apply only their **difference** to the
high-fidelity SGP4 state:

```
Δr(t) = r_twobody_maneuvered(t) − r_twobody_unmaneuvered(t)
r_primary(t) ≈ r_primary_SGP4(t) + Δr(t)
```

This **differential correction** cancels the two-body modelling error to first order,
so the reported post-maneuver miss and Pc are anchored to SGP4 rather than to a coarse
Kepler approximation. We then evaluate the post-burn close approach across a ±90 s
window to capture the shifted TCA.

Propellant is reported from the rocket equation for a reference 500 kg / 220 s-Isp bus.

## 5. What is validated

`tests/engine.test.ts` checks:

- the ISS sits in a correct LEO orbit (perigee, apogee, inclination bounds);
- the two-body propagator conserves energy and angular momentum to 1 part in 10⁶ and
  closes one full revolution to under 5 cm;
- Foster Pc matches the closed form `Pc = 1 - exp(-R²/2σ²)` for an isotropic centered
  encounter (an absolute-value check, not just ordering);
- Foster Pc matches an independent 3D Monte-Carlo estimate (500k samples) for an
  anisotropic encounter to within 10 percent, cross-validating the encounter-plane
  projection and quadrature against direct sampling;
- the covariance rotation is exact: `C·I = σ_i² · I`, i.e. the in-track unit vector is
  the eigenvector of the largest uncertainty in ECI;
- the covariance trace grows with element age;
- end to end, screening the real QIANFAN-168 vs FENGYUN-1C conjunction yields a valid
  Foster Pc and the planner reduces it while widening the miss;
- a slow co-orbital pair is correctly flagged Foster-invalid and the planner declines it.

## 6. Known limitations (and the upgrade path)

| Limitation | Why | Upgrade |
|------------|-----|---------|
| Modelled covariance | TLEs carry none | Ingest operator/OD covariance (CDM) |
| Per-class hard-body radii | No sizes in catalog | Use registry/RCS-derived dimensions |
| Impulsive burns | Simplifies optimisation | Finite-burn modelling for low-thrust |
| Single-asset autonomy | MVP scope | Fleet-wide de-confliction so assets do not avoid into each other |
