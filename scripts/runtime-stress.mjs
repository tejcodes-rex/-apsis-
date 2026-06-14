/**
 * Runtime stress: hammer the live app with rapid, randomized interactions and
 * watch for console errors, page crashes, and JS-heap growth (leak detection).
 * Exits non-zero on any console error or runaway memory.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:4010";
const errors = [];
async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, args: ["--js-flags=--expose-gc"] });
    } catch {
      /* next */
    }
  }
  return chromium.launch();
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("crash", () => errors.push("PAGE CRASHED"));

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !document.body.innerText.includes("Loading orbital catalog"), {
  timeout: 60000,
});
await page.waitForTimeout(2500);

const heap = async () =>
  page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
const h0 = await heap();

const rnd = (n) => Math.floor(Math.random() * n);
let actions = 0;
const ROUNDS = 40;
for (let i = 0; i < ROUNDS; i++) {
  try {
    const r = i % 8;
    if (r === 0) {
      const f = page.getByTestId("featured-event");
      const n = await f.count();
      if (n) await f.nth(rnd(n)).click({ timeout: 3000 });
    } else if (r === 1 || r === 2) {
      // click a random watchlist row
      const rows = page.locator('button:has(.dot)');
      const n = await rows.count();
      if (n) await rows.nth(rnd(n)).click({ timeout: 2000 });
    } else if (r === 3) {
      const p = page.getByTestId("plan-maneuver");
      if (await p.count()) await p.click({ timeout: 2000 }).catch(() => {});
    } else if (r === 4) {
      const j = page.getByTestId("jump-tca");
      if (await j.count()) await j.click({ timeout: 2000 }).catch(() => {});
    } else if (r === 5) {
      const b = page.locator("button", { hasText: "Stations" }).first();
      if (await b.count()) await b.click({ timeout: 2000 }).catch(() => {});
    } else if (r === 6) {
      // toggle time scale buttons rapidly
      for (const lbl of ["1×", "30m/s", "Now"]) {
        const b = page.locator("button", { hasText: lbl }).first();
        if (await b.count()) await b.click({ timeout: 1500 }).catch(() => {});
      }
    } else {
      // search + pick a payload
      const inp = page.locator('input[placeholder*="Search payloads"]');
      if (await inp.count()) {
        await inp.fill(["STARLINK", "COSMOS", "ISS", "ONEWEB"][rnd(4)]);
        await page.waitForTimeout(150);
        const opt = page.locator('button:has-text("STARLINK"), button:has-text("COSMOS")').first();
        if (await opt.count()) await opt.click({ timeout: 1500 }).catch(() => {});
        await inp.fill("");
      }
    }
    actions++;
    await page.waitForTimeout(180 + rnd(220));
  } catch (e) {
    // a control being transiently unhittable is fine; a real error lands in `errors`
  }
}

await page.waitForTimeout(1500);
await page.evaluate(() => window.gc && window.gc());
await page.waitForTimeout(500);
const h1 = await heap();

await browser.close();

console.log(`actions: ${actions}/${ROUNDS}`);
if (h0 && h1) console.log(`heap: ${(h0 / 1e6).toFixed(1)} MB -> ${(h1 / 1e6).toFixed(1)} MB`);
const growth = h0 ? (h1 - h0) / h0 : 0;

let bad = false;
if (errors.length) {
  console.error("CONSOLE ERRORS:");
  for (const e of [...new Set(errors)]) console.error("  -", e);
  bad = true;
}
// Heap growing more than 4x over the session suggests a real leak.
if (h0 && growth > 3) {
  console.error(`HEAP GREW ${(growth * 100).toFixed(0)}% — possible leak`);
  bad = true;
}
if (bad) process.exit(1);
console.log("runtime stress OK: no console errors, no crash, heap stable");
