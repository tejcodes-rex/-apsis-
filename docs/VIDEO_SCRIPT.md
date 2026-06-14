# APSIS — Demo Video Script (target 3:00, hard cap 5:00)

Format: screen recording of the live app + voiceover. Record at 1080p, app at the
default protected asset (ISS). Keep the cursor deliberate. Numbers on screen are the
real engine output — do not narrate values that differ from what is shown.

Tip: open the app, let it boot, and pause time (❚❚) before recording the intro so the
globe is calm. Use Time Scale 60× for ambient motion.

---

### 0:00 — 0:20 · Hook
> "There are over thirty thousand tracked objects in orbit, closing on each other at
> fourteen kilometers a second. Today, humans clear these collision risks by hand. That
> does not scale to the constellations we are launching. This is APSIS — autonomous
> space traffic management."

Visual: slow orbit of the globe, 8,000 objects glowing, title legible in the header.

### 0:20 — 0:45 · What we are looking at
> "Every point is a real object from the live NORAD catalog — payloads in cyan, rocket
> bodies in amber, debris in orange. These are propagated with SGP4, the same model
> operators use. The green asset is the satellite we are protecting; right now, the
> International Space Station."

Visual: point out the type colors; hover/zoom slightly; show the Protected Asset panel
and its orbit numbers.

### 0:45 — 1:20 · The real threat
> "APSIS continuously screens our asset against the entire catalog. But let me load the
> most dangerous predicted event it found — an active satellite, Qianfan-168, and a
> fragment from the 2007 Fengyun anti-satellite test."

Action: click the top entry under **Predicted High-Energy Events**.

> "Closest approach: three hundred meters. Relative speed: thirteen kilometers per
> second. Collision probability: one-point-one times ten to the minus four — above the
> industry action threshold. This is not staged; it is recomputed live, and the script
> that finds it is in the repo."

Visual: the watchlist populates, the conjunction is selected, the assessment panel shows
the numbers, the secondary turns red on the globe with its orbit drawn.

### 1:20 — 1:50 · See it
Action: click **Jump to Closest Approach**, let time run to the encounter.
> "Here is the encounter itself — the two objects converging. At this speed, a collision
> fragments both into thousands of new pieces, and that is how Kessler syndrome starts."

### 1:50 — 2:40 · Autonomous decision
Action: click **Plan Avoidance Maneuver**.
> "Now APSIS acts. It searches the maneuver space — when to burn, and how hard — and
> finds the minimum-propellant solution. A sub-meter-per-second in-track burn, executed
> about ninety minutes before closest approach. Watch the cyan arc: that is the actual
> recomputed post-burn orbit."

> "The probability drops from one times ten to the minus four down to the ten-to-the-
> minus-seven range — a hundred-fold-plus reduction — for under ten grams of propellant.
> And it explains the decision in plain language, citing its own numbers."

Visual: maneuver console fills in; read the rationale box on screen; cyan arc visibly
diverges from the nominal track on the globe.

### 2:40 — 3:00 · Scale + close
Action: click **Run Global Scan**, let the progress bar move.
> "And it is not one asset at a time. This is an all-pairs sieve across an entire debris
> shell — the architecture scales to constellation traffic. Real data, real physics,
> real autonomy. APSIS — keeping orbit usable."

Visual: global scan progress, results count, then pull back to a wide shot of the globe.

---

## Capture checklist
- [ ] 1080p or higher, 60 fps if possible (the globe is smooth — show it)
- [ ] Engine booted, no boot overlay on screen during recording
- [ ] Read only numbers that are actually displayed
- [ ] Show the GitHub repo URL on the closing frame or in the description
- [ ] Keep under 5:00; aim for 3:00

## One-line submission blurb
> APSIS is an autonomous space-traffic-management platform: it screens a live NORAD
> catalog with SGP4, computes real collision probabilities with Foster's method, and
> autonomously plans the minimum-propellant avoidance maneuver — visualized on a
> real-time 3D mission-control globe.
