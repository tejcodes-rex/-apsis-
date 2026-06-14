/**
 * Headless smoke test + screenshot capture.
 * Loads the running app, waits for the engine to boot, exercises the scenario
 * flow, and writes screenshots to docs/screens. Fails on any console error.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3939";
const OUT = "docs/screens";
mkdirSync(OUT, { recursive: true });

const errors = [];
// Use a system-installed Chromium browser (Chrome, then Edge) so the smoke test
// does not depend on Playwright's bundled-browser download.
async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel });
    } catch {
      /* try next channel */
    }
  }
  return chromium.launch();
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

console.log("Loading", BASE);
try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Wait for the boot overlay to disappear (engine ready).
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading orbital catalog"),
    { timeout: 90000 },
  );
} catch (err) {
  console.error("BOOT FAILED:", err.message);
  await page.screenshot({ path: `${OUT}/00-boot-failure.png` });
  if (errors.length) {
    console.error("CONSOLE ERRORS:");
    for (const e of errors) console.error("  -", e);
  } else {
    console.error("(no console errors captured)");
  }
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(3500); // let positions stream + globe settle
await page.screenshot({ path: `${OUT}/01-overview.png` });
console.log("captured overview");

// Load the top predicted high-energy event.
const heroBtn = page.getByTestId("featured-event").first();
if (await heroBtn.count()) {
  await heroBtn.click();
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${OUT}/02-scenario.png` });
  console.log("captured scenario");
}

// Capture the encounter-plane (B-plane) analysis panel.
const bplane = page.locator("section", { hasText: "Encounter Plane" }).first();
if (await bplane.count()) {
  await bplane.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await bplane.screenshot({ path: `${OUT}/05-bplane.png` });
  console.log("captured bplane");
  await page.evaluate(() => window.scrollTo(0, 0));
}

// Plan the avoidance maneuver.
const planBtn = page.getByTestId("plan-maneuver").first();
if (await planBtn.count()) {
  await planBtn.click();
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${OUT}/03-maneuver.png` });
  console.log("captured maneuver");
}

// Jump to closest approach for a dramatic frame.
const jumpBtn = page.getByTestId("jump-tca").first();
if (await jumpBtn.count()) {
  await jumpBtn.click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/04-tca.png` });
  console.log("captured tca");
}

await browser.close();

if (errors.length) {
  console.error("\nCONSOLE ERRORS:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log("\nNo console errors. Smoke test passed.");
