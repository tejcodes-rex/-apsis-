# APSIS, Submission Pack

Everything needed to fill the FAR AWAY Round 1 submission form. Copy/paste as needed.

## Required deliverables (Round 1)
- [x] **GitHub repository**, source, docs, setup instructions (this repo)
- [x] **Project submission**, pitch deck (`deck/index.html`, ≤15 slides, demo shown) and a
      recorded demo video (script in `docs/VIDEO_SCRIPT.md`)
- [x] **Hardware (optional, included)**, `hardware/` reference design with schematic, RF
      analysis, BOM, and netlist

## Title
APSIS, Autonomous Space Traffic Management

## One-line tagline
Real-time conjunction screening, collision-probability assessment, and autonomous
avoidance-maneuver planning for objects in Earth orbit, on live NORAD data.

## Theme
Space & Aerospace

## Elevator pitch (≈ 50 words)
Orbit is filling with debris moving at 14 km/s, and operators still clear collision
risks by hand. APSIS is autonomous space-traffic control: it screens a live catalog,
computes real collision probabilities, and plans the minimum-propellant avoidance
maneuver, visualized on a 3D mission-control globe. Real data, real physics, real
autonomy.

## What it does
- Ingests a live NORAD/CelesTrak catalog (8,400+ real objects, including the actual
  Fengyun-1C, Iridium-33, Cosmos-2251 and Cosmos-1408 debris clouds).
- Propagates every object with SGP4 and screens a protected asset against the whole
  catalog, or runs an all-pairs spatial-hash sieve across an orbital shell.
- Computes time of closest approach, miss distance, and collision probability using
  Foster's 2D method (the operational standard at NASA CARA / ESA).
- When probability crosses the action threshold, autonomously plans the
  minimum-propellant avoidance maneuver and explains the decision in plain language.
- Visualizes everything in real time on a 3D WebGL mission-control globe.

## How we built it
TypeScript astrodynamics core (SGP4 via satellite.js; custom conjunction screening,
Foster collision probability, covariance model, universal-variable two-body solver,
and a differential-correction maneuver optimizer). All heavy compute runs in a Web
Worker; the 3D globe is Three.js with custom point and atmosphere shaders. App is
Next.js 15 + React 19 + Zustand + Tailwind. Engine validated with a Vitest suite.

## Real, reproducible result
QIANFAN-168 (active satellite) vs a Fengyun-1C ASAT debris fragment, miss 0.31 km,
relative speed 13.1 km/s, collision probability 1.07×10⁻⁴ (above the 1×10⁻⁴ action
line). Found by re-running `scripts/find-events.ts`; resolved by a sub-m/s in-track
burn.

## Challenges
- Computing a defensible collision probability from TLE data, which carries no
  covariance, solved with a documented, replaceable uncertainty model.
- Propagating a post-burn orbit when SGP4 cannot continue from an arbitrary state, solved with a two-body solver plus differential correction anchored to SGP4.
- Screening thousands of objects interactively, solved with a geometric sieve plus a
  spatial-hash all-pairs filter, all off the main thread.

## Accomplishments
A working, tested platform (8/8 engine tests) that runs the full predict → assess →
decide → act loop on real data, with autonomy that is real optimization rather than an
AI wrapper, and a demo that is reproducible rather than staged.

## What's next
Operator/CDM covariance ingest, multi-asset fleet protection, ground-node hardware for
crowdsourced tracking, and constellation-scale maneuver de-confliction.

## Tech stack
Next.js 15 · React 19 · TypeScript (strict) · Three.js · satellite.js · Zustand ·
Tailwind · Vitest · Playwright (smoke).

## Run locally
```
npm install
npm run dev      # http://localhost:3000
npm test         # engine validation suite
```
