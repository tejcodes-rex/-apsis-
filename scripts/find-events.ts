/**
 * Precompute genuine close-approach events from the bundled catalog so the app
 * always opens on a real, verifiable conjunction rather than a contrived one.
 *
 * We run the all-pairs sieve against the dense ~700-900 km debris shell (where
 * the Fengyun-1C, Iridium-33 and Cosmos-2251/1408 fragments live) because that
 * is where real conjunctions cluster. The output is written to
 * public/data/featured-events.json. Anyone can re-run this and reproduce it.
 *
 * Run: npx tsx scripts/find-events.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCatalog } from "../lib/astro/catalog";
import { screenAllPairs } from "../lib/conjunction/sieve";
import type { SpaceObject } from "../lib/astro/types";

const raw = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "catalog.json"), "utf8"));
const catalog = buildCatalog(raw);

// Focus on the congested LEO shell to keep the precompute fast and relevant.
const shell: SpaceObject[] = catalog.objects.filter((o) => {
  const meanAlt = (o.orbit.apogeeKm + o.orbit.perigeeKm) / 2;
  return meanAlt > 650 && meanAlt < 950 && o.orbit.regime === "LEO";
});

console.log(`Shell objects (650-950 km LEO): ${shell.length}`);

// Anchor the screening window to the catalog's own epoch so it is reproducible
// regardless of when the script runs.
const epochs = shell.map((o) => {
  const yr = parseInt(o.tle.line1.slice(18, 20), 10);
  const doy = parseFloat(o.tle.line1.slice(20, 32));
  const year = yr < 57 ? 2000 + yr : 1900 + yr;
  return Date.UTC(year, 0, 1) + (doy - 1) * 86_400_000;
});
const nowMs = Math.max(...epochs); // most recent element epoch in the shell

const t0 = Date.now();
const conjunctions = screenAllPairs(shell, nowMs, {
  windowHours: 24,
  stepSec: 18,
  gateKm: 8,
  cellKm: 70,
  onProgress: (f, phase) => {
    if (Math.round(f * 100) % 10 === 0) process.stdout.write(`\r  ${phase}: ${(f * 100).toFixed(0)}%   `);
  },
});

console.log(`\nScreened in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${conjunctions.length} approaches found`);

// Only feature genuine hypervelocity conjunctions, where the Foster 2D Pc is
// physically valid. Slow co-orbital pairs (formation flying / station-keeping)
// are excluded from the featured set.
const top = conjunctions.filter((c) => c.fosterValid).slice(0, 40);
for (const c of top.slice(0, 10)) {
  console.log(
    `  ${c.missKm.toFixed(3)} km  Pc=${c.pc.toExponential(2)}  ${c.relativeSpeedKmps.toFixed(1)} km/s  ` +
      `${c.primaryName} <> ${c.secondaryName}`,
  );
}

writeFileSync(
  join(process.cwd(), "public", "data", "featured-events.json"),
  JSON.stringify(
    {
      generatedAtIso: new Date().toISOString(),
      screenedFromEpochMs: nowMs,
      shellObjectCount: shell.length,
      windowHours: 24,
      events: top,
    },
    null,
    2,
  ),
);
console.log(`\nWrote ${top.length} featured events to public/data/featured-events.json`);
