/**
 * Capture all pitch-deck slides as images and assemble them into a 16:9 PPTX,
 * so the submission has a slide-deck upload option alongside the demo video
 * (the Unstop form accepts mp4 or pptx).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SLIDES = 14;
const DIR = "submission/_slides";
mkdirSync(DIR, { recursive: true });
const url = pathToFileURL(resolve("deck/index.html")).href;

async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel });
    } catch {
      /* next */
    }
  }
  return chromium.launch();
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: "load" });
for (let i = 0; i < SLIDES; i++) {
  if (i > 0) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${DIR}/slide-${String(i).padStart(2, "0")}.png` });
}
await browser.close();
console.log(`captured ${SLIDES} slides -> ${DIR}`);

// Assemble the PPTX with python-pptx (one full-bleed image per 16:9 slide).
const py = `
import glob, os
from pptx import Presentation
from pptx.util import Inches
prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
blank = prs.slide_layouts[6]
for f in sorted(glob.glob(r"${DIR}/slide-*.png".replace("\\\\","/"))):
    s = prs.slides.add_slide(blank)
    s.shapes.add_picture(f, 0, 0, width=prs.slide_width, height=prs.slide_height)
out = r"submission/APSIS-deck.pptx"
prs.save(out)
print("wrote", out, "with", len(prs.slides._sldIdLst), "slides")
`;
const r = spawnSync("python", ["-c", py], { encoding: "utf8" });
process.stdout.write(r.stdout || "");
if (r.status !== 0) {
  process.stderr.write(r.stderr || "");
  process.exit(1);
}
