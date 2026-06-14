import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const OUT = "docs/screens";
mkdirSync(OUT, { recursive: true });
const url = pathToFileURL(resolve("deck/index.html")).href;
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
await page.goto(url, { waitUntil: "load" });

const slides = [1, 5, 7]; // title, hero result, maneuver depth
for (const n of slides) {
  for (let i = 1; i < n; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/deck-${String(n).padStart(2, "0")}.png` });
  // reset to start
  for (let i = 0; i < 14; i++) await page.keyboard.press("ArrowLeft");
}
await browser.close();
if (errors.length) {
  console.error("DECK ERRORS:", errors);
  process.exit(1);
}
console.log("deck rendered, screenshots captured");
