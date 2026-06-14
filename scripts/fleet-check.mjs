import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:4010";
const errors = [];
async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launch({ channel }); } catch { /* next */ }
  }
  return chromium.launch();
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !document.body.innerText.includes("Loading orbital catalog"), { timeout: 60000 });
await page.waitForTimeout(2500);

// Trigger the Stations fleet scan (small fleet => quick).
const btn = page.locator("button", { hasText: "Stations" }).first();
await btn.click();
// Wait for the board to populate (asset rows with a Pc appear).
await page.waitForFunction(
  () => document.body.innerText.includes("assets screened"),
  { timeout: 120000 },
);
await page.waitForTimeout(800);
const fleetPanel = page.locator("section", { hasText: "Fleet Protection" }).first();
await fleetPanel.screenshot({ path: "docs/screens/06-fleet.png" });
const text = await fleetPanel.innerText();
console.log("FLEET PANEL TEXT:\n" + text.split("\n").slice(0, 12).join("\n"));
await browser.close();
if (errors.length) { console.error("ERRORS:", errors); process.exit(1); }
console.log("\nfleet scan OK, no console errors");
