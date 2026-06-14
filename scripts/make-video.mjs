/**
 * Produce the APSIS demo video: a real screen recording of the live app driven
 * through the full story, with a neural voiceover and synced on-screen captions.
 *
 * Pipeline:
 *   1. Generate neural narration per segment (edge-tts) and measure each duration.
 *   2. Drive the app with Playwright, recording video; hold each beat for exactly
 *      its narration length and show a synced caption.
 *   3. Concatenate the narration and mux it onto the recording with ffmpeg.
 *
 * Requires the production server running (npm run start) at BASE.
 */
import { chromium } from "playwright";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import ffmpegPath from "ffmpeg-static";

const BASE = process.env.BASE ?? "http://localhost:4010";
const OUT = "video";
const RAW = "video/raw";
mkdirSync(OUT, { recursive: true });
rmSync(RAW, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });

const VOICE = "en-US-GuyNeural";
const RATE = "-6%"; // a touch slower for clarity and gravitas

// Each segment: spoken narration, the on-screen caption, and the app action to
// perform at the start of the beat. The beat is held for the narration length.
const SEGMENTS = [
  {
    cap: "Autonomous Space Traffic Management",
    say: "Right now, more than thirty thousand tracked objects are racing around Earth, and they cross paths at fourteen kilometers per second. Today, humans clear these collision risks by hand. That does not scale. This is APSIS.",
    title: true,
    act: async (p) => {
      await dragGlobe(p, 60);
    },
  },
  {
    cap: "A live catalog of real objects",
    say: "Every point is a real object from the live NORAD catalog. Payloads in cyan, rocket bodies in amber, debris in orange, each propagated with the same SGP4 model that operators use. The green asset is the satellite we are protecting.",
    act: async (p) => {
      await dragGlobe(p, -40);
    },
  },
  {
    cap: "The most dangerous predicted event",
    say: "APSIS screens that asset against the entire catalog. Here is the most dangerous event it found: an active satellite, Qianfan one sixty eight, and a fragment from the two thousand seven anti-satellite test.",
    act: async (p) => {
      await click(p, p.getByTestId("featured-event").first());
    },
  },
  {
    cap: "Recomputed live. Nothing staged.",
    say: "Closest approach: three hundred fourteen meters. Relative speed: thirteen kilometers per second. Collision probability above the action threshold. This is recomputed live, and the script that finds it is in the repository.",
    act: async () => {},
  },
  {
    cap: "The real collision geometry",
    say: "This is the actual collision geometry, the encounter plane. The ellipse is our position uncertainty. The red disk is the combined hard body radius. The miss vector sits inside one sigma, and that is exactly why the probability is high. The curve shows how the risk peaks through closest approach.",
    act: async (p) => {
      await scrollTo(p, "Encounter Plane");
    },
  },
  {
    cap: "The encounter, at thirteen km/s",
    say: "Here is the encounter itself. At this speed a collision shatters both objects into thousands of new fragments. This is how Kessler syndrome begins.",
    act: async (p) => {
      await click(p, p.getByTestId("jump-tca"));
    },
  },
  {
    cap: "Autonomous avoidance maneuver",
    say: "Now APSIS acts. It searches the maneuver space and finds the minimum propellant burn that removes the risk. A sub meter per second nudge, executed hours before closest approach. The cyan arc is the recomputed orbit.",
    act: async (p) => {
      await scrollTo(p, "Autonomous Response");
      await click(p, p.getByTestId("plan-maneuver"));
    },
  },
  {
    cap: "Orders of magnitude safer, for grams of fuel",
    say: "Probability drops by orders of magnitude. The miss opens to several kilometers, for a few grams of propellant. And it explains every decision in plain language.",
    act: async () => {},
  },
  {
    cap: "Protect a whole constellation",
    say: "And it is not one satellite at a time. APSIS screens an entire constellation at once, and ranks every asset by its worst conjunction.",
    act: async (p) => {
      await scrollTo(p, "Fleet Protection");
      await click(p, p.locator("button", { hasText: "Stations" }).first());
    },
  },
  {
    cap: "Real data. Real physics. Real autonomy.",
    say: "Real data. Real physics. Real autonomy. Keeping orbit usable for the next generation. APSIS.",
    act: async (p) => {
      await p.evaluate(() => window.scrollTo(0, 0));
      await dragGlobe(p, 90);
    },
  },
];

function ff(args) {
  return execFileSync(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
}

function durationSec(file) {
  // ffmpeg prints duration to stderr; parse "Duration: HH:MM:SS.xx".
  const r = spawnSync(ffmpegPath, ["-i", file], { encoding: "utf8" });
  const m = (r.stderr || "").match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (!m) return 3;
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

async function tts(text, file) {
  const r = spawnSync(
    "python",
    ["-m", "edge_tts", "--voice", VOICE, `--rate=${RATE}`, "--text", text, "--write-media", file],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error("tts failed: " + (r.stderr || r.stdout));
}

async function click(page, locator) {
  try {
    if (await locator.count()) await locator.click({ timeout: 5000 });
  } catch {
    /* keep the video rolling even if one control is not hittable */
  }
}

async function scrollTo(page, text) {
  try {
    const el = page.locator("section", { hasText: text }).first();
    if (await el.count()) await el.scrollIntoViewIfNeeded();
  } catch {
    /* ignore */
  }
}

async function dragGlobe(page, dx) {
  // Slow horizontal drag across the globe (canvas center) for cinematic motion.
  const cx = 800;
  const cy = 470;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(cx + (dx * i) / steps, cy);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

const CAPTION_JS = `
  (() => {
    if (document.getElementById('vcap')) return;
    const s = document.createElement('style');
    s.textContent = \`
      #vcap{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:9999;
        max-width:60vw;padding:14px 26px;border-radius:12px;
        background:rgba(5,7,13,0.72);backdrop-filter:blur(8px);
        border:1px solid rgba(79,214,255,0.25);box-shadow:0 0 30px -8px rgba(79,214,255,0.4);
        font-family:'Space Grotesk',system-ui,sans-serif;color:#eaf4ff;font-size:22px;
        letter-spacing:0.01em;text-align:center;opacity:0;transition:opacity .4s ease}
      #vcap .bar{height:2px;width:40px;margin:0 auto 10px;background:#4fd6ff;border-radius:2px;box-shadow:0 0 10px #4fd6ff}
      #vtitle{position:fixed;inset:0;z-index:9998;display:flex;flex-direction:column;align-items:center;
        justify-content:center;background:radial-gradient(circle at 50% 45%,rgba(5,7,13,0.4),rgba(5,7,13,0.85));
        opacity:0;transition:opacity .6s ease;pointer-events:none}
      #vtitle .logo{font-family:'JetBrains Mono',monospace;font-size:84px;font-weight:600;letter-spacing:0.34em;
        color:#fff;text-shadow:0 0 40px rgba(79,214,255,0.6)}
      #vtitle .sub{margin-top:14px;font-family:'JetBrains Mono',monospace;font-size:15px;letter-spacing:0.34em;
        text-transform:uppercase;color:#7ee4ff}
    \`;
    document.head.appendChild(s);
    const c = document.createElement('div'); c.id='vcap';
    c.innerHTML = '<div class="bar"></div><span id="vcaptxt"></span>';
    document.body.appendChild(c);
    const t = document.createElement('div'); t.id='vtitle';
    t.innerHTML = '<div class="logo">APSIS</div><div class="sub">Autonomous Space Traffic Management</div>';
    document.body.appendChild(t);
  })();
`;

async function setCaption(page, text) {
  await page.evaluate((t) => {
    const cap = document.getElementById("vcap");
    const txt = document.getElementById("vcaptxt");
    if (!cap || !txt) return;
    cap.style.opacity = "0";
    setTimeout(() => {
      txt.textContent = t;
      cap.style.opacity = "1";
    }, 220);
  }, text);
}

async function showTitle(page, on) {
  await page.evaluate((o) => {
    const t = document.getElementById("vtitle");
    if (t) t.style.opacity = o ? "1" : "0";
  }, on);
}

async function main() {
  console.log("Generating neural narration...");
  const segs = [];
  let total = 0;
  for (let i = 0; i < SEGMENTS.length; i++) {
    const file = resolve(RAW, `seg-${String(i).padStart(2, "0")}.mp3`);
    await tts(SEGMENTS[i].say, file);
    const d = durationSec(file);
    segs.push({ ...SEGMENTS[i], file, dur: d });
    total += d + 0.35;
    console.log(`  seg ${i}: ${d.toFixed(2)}s  "${SEGMENTS[i].cap}"`);
  }
  console.log(`Narration total ~ ${total.toFixed(1)}s`);

  console.log("Recording app...");
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
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: RAW, size: { width: 1600, height: 900 } },
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.body.innerText.includes("Loading orbital catalog"), {
    timeout: 60000,
  });
  await page.waitForTimeout(2500);
  await page.evaluate(CAPTION_JS);

  const startMs = Date.now();
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.title) await showTitle(page, true);
    await setCaption(page, s.cap);
    if (s.title) {
      await page.waitForTimeout(Math.min(2600, s.dur * 1000 * 0.5));
      await showTitle(page, false);
    }
    try {
      await s.act(page);
    } catch (e) {
      console.warn(`  seg ${i} action issue: ${e.message}`);
    }
    const elapsedInSeg = 0;
    const hold = Math.max(s.dur * 1000 + 350 - elapsedInSeg, 1200);
    await page.waitForTimeout(hold);
  }
  const recordedMs = Date.now() - startMs;
  await page.waitForTimeout(400);
  await context.close(); // flushes the video file
  await browser.close();

  // Find the produced webm.
  const webm = readdirSync(RAW).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("no recording produced");
  const webmPath = resolve(RAW, webm);
  console.log(`Recorded ${(recordedMs / 1000).toFixed(1)}s -> ${webm}`);

  // Concatenate narration with the same per-segment gaps used while recording.
  console.log("Building narration track...");
  const listLines = [];
  const silence = resolve(RAW, "sil.mp3");
  ff(["-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "0.35", "-q:a", "9", silence]);
  for (const s of segs) {
    listLines.push(`file '${s.file.replace(/\\/g, "/")}'`);
    listLines.push(`file '${silence.replace(/\\/g, "/")}'`);
  }
  const listFile = resolve(RAW, "list.txt");
  writeFileSync(listFile, listLines.join("\n"));
  const narration = resolve(RAW, "narration.m4a");
  ff(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "aac", "-b:a", "160k", narration]);

  // Mux: trim the boot/pre-roll, scale, encode H.264 + AAC, stop at narration end.
  const preRollSec = 2.9; // boot wait + caption inject before segment 1
  const finalOut = resolve(OUT, "APSIS-demo.mp4");
  console.log("Muxing final video...");
  ff([
    "-y",
    "-ss",
    String(preRollSec),
    "-i",
    webmPath,
    "-i",
    narration,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-shortest",
    "-movflags",
    "+faststart",
    finalOut,
  ]);

  console.log(`\nDONE -> ${finalOut}`);
  console.log(`final duration ~ ${durationSec(finalOut).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
