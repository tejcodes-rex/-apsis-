/**
 * Produce the APSIS demo video: a real screen recording of the live app driven
 * through the full story, with a natural neural voiceover precisely synced to
 * the visuals, plus on-screen captions.
 *
 * Sync model: for every beat we fire the UI action, hold for `settleMs` while
 * the view updates/animates, and only THEN begin that beat's narration. The
 * audio for each beat is built as [settleMs of silence] + [narration] + [tail],
 * so the spoken words line up with the moment the corresponding visual is on
 * screen, not before it. Audio and video advance by identical per-beat durations
 * so they never drift.
 *
 * Requires the production server running (npm run start) at BASE.
 */
import { chromium } from "playwright";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import ffmpegPath from "ffmpeg-static";

const BASE = process.env.BASE ?? "http://localhost:4010";
const OUT = "video";
const RAW = "video/raw";
mkdirSync(OUT, { recursive: true });
rmSync(RAW, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });

const VOICE = "en-US-AndrewMultilingualNeural"; // warm, confident, natural
const RATE = "-3%";
const TAIL = 0.45; // seconds of breathing room after each beat

// Each beat: spoken narration, on-screen caption, the UI action to perform, and
// how long to let the view settle after the action before the narration starts.
const SEGMENTS = [
  {
    cap: "Autonomous Space Traffic Management",
    say: "Thirty thousand objects. Fourteen kilometers per second. And today, humans still clear these collision risks by hand. That does not scale. This is APSIS.",
    title: true,
    settleMs: 2600,
    act: async (p) => dragGlobe(p, 70),
  },
  {
    cap: "A live catalog of real objects",
    say: "Every point is real, propagated from the live NORAD catalog with the same model operators use. Payloads, rocket bodies, and the debris from real anti-satellite events, still crossing the busiest orbits.",
    settleMs: 800,
    act: async (p) => dragGlobe(p, -45),
  },
  {
    cap: "The most dangerous predicted approach",
    say: "APSIS screens one protected satellite against the entire catalog, and flags the most dangerous approach it finds.",
    settleMs: 2600,
    act: async (p) => click(p, p.getByTestId("featured-event").first()),
  },
  {
    cap: "Recomputed live. Nothing staged.",
    say: "An active satellite, and a fragment from a two thousand seven weapons test. Three hundred meters apart, closing at thirteen kilometers per second. Collision probability above the action line. This is recomputed live.",
    settleMs: 300,
    act: async () => {},
  },
  {
    cap: "The real collision geometry",
    say: "This is the actual geometry. Our position uncertainty as an ellipse, the combined hard body as a disk, and the miss vector sitting inside one sigma. That is exactly why the probability is high.",
    settleMs: 1100,
    act: async (p) => scrollTo(p, "Encounter Plane"),
  },
  {
    cap: "How Kessler syndrome begins",
    say: "Watch the encounter. At this speed, a single impact shatters both objects into thousands of new fragments. This is how Kessler syndrome begins.",
    settleMs: 600,
    act: async (p) => click(p, p.getByTestId("jump-tca")),
  },
  {
    cap: "Autonomous avoidance maneuver",
    say: "Now APSIS acts. It searches the maneuver space for the smallest possible burn that takes the risk away.",
    settleMs: 1200,
    act: async (p) => {
      await scrollTo(p, "Autonomous Response");
      await click(p, p.getByTestId("plan-maneuver"));
    },
  },
  {
    cap: "Orders of magnitude safer, for grams of fuel",
    say: "A few centimeters per second, hours ahead of closest approach, and the probability drops by orders of magnitude. The cyan arc is the recomputed orbit. For a few grams of fuel.",
    settleMs: 1200,
    act: async () => {},
  },
  {
    cap: "Protect a whole constellation",
    say: "And not one satellite at a time. APSIS screens an entire constellation at once, and ranks every asset by its risk.",
    settleMs: 1600,
    act: async (p) => {
      await scrollTo(p, "Fleet Protection");
      await click(p, p.locator("button", { hasText: "Stations" }).first());
    },
  },
  {
    cap: "Real data. Real physics. Real autonomy.",
    say: "Real data. Real physics. Real autonomy. Keeping orbit usable, for everyone who comes next. APSIS.",
    settleMs: 900,
    act: async (p) => {
      await p.evaluate(() => window.scrollTo(0, 0));
      await dragGlobe(p, 95);
    },
  },
];

function ff(args) {
  return execFileSync(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
}

function durationSec(file) {
  const r = spawnSync(ffmpegPath, ["-i", file], { encoding: "utf8" });
  const m = (r.stderr || "").match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (!m) return 3;
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

function tts(text, file) {
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
    /* keep rolling */
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
  const cx = 800;
  const cy = 470;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const steps = 28;
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
        max-width:62vw;padding:14px 28px;border-radius:12px;
        background:rgba(5,7,13,0.74);backdrop-filter:blur(8px);
        border:1px solid rgba(79,214,255,0.28);box-shadow:0 0 34px -8px rgba(79,214,255,0.45);
        font-family:'Space Grotesk',system-ui,sans-serif;color:#eaf4ff;font-size:23px;
        letter-spacing:0.01em;text-align:center;opacity:0;transition:opacity .45s ease}
      #vcap .bar{height:2px;width:44px;margin:0 auto 10px;background:#4fd6ff;border-radius:2px;box-shadow:0 0 12px #4fd6ff}
      #vtitle{position:fixed;inset:0;z-index:9998;display:flex;flex-direction:column;align-items:center;
        justify-content:center;background:radial-gradient(circle at 50% 45%,rgba(5,7,13,0.35),rgba(5,7,13,0.82));
        opacity:0;transition:opacity .7s ease;pointer-events:none}
      #vtitle .logo{font-family:'JetBrains Mono',monospace;font-size:88px;font-weight:600;letter-spacing:0.36em;
        color:#fff;text-shadow:0 0 44px rgba(79,214,255,0.65)}
      #vtitle .sub{margin-top:16px;font-family:'JetBrains Mono',monospace;font-size:15px;letter-spacing:0.36em;
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
    }, 200);
  }, text);
}
async function showTitle(page, on) {
  await page.evaluate((o) => {
    const t = document.getElementById("vtitle");
    if (t) t.style.opacity = o ? "1" : "0";
  }, on);
}

async function main() {
  console.log(`Generating neural narration (${VOICE})...`);
  const segs = [];
  for (let i = 0; i < SEGMENTS.length; i++) {
    const s = SEGMENTS[i];
    const raw = resolve(RAW, `n-${String(i).padStart(2, "0")}.mp3`);
    tts(s.say, raw);
    const narrSec = durationSec(raw);
    // Build the beat's audio: leading silence (settle) + narration + tail.
    const full = resolve(RAW, `s-${String(i).padStart(2, "0")}.m4a`);
    const delayMs = Math.max(0, Math.round(s.settleMs));
    ff([
      "-y",
      "-i",
      raw,
      "-af",
      `adelay=${delayMs}:all=1,apad=pad_dur=${TAIL}`,
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      full,
    ]);
    const totalSec = s.settleMs / 1000 + narrSec + TAIL;
    segs.push({ ...s, full, narrSec, totalSec });
    console.log(`  beat ${i}: settle ${(s.settleMs / 1000).toFixed(1)}s + say ${narrSec.toFixed(1)}s  "${s.cap}"`);
  }
  const totalAll = segs.reduce((a, s) => a + s.totalSec, 0);
  console.log(`Total ~ ${totalAll.toFixed(1)}s`);

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
  const recordT0 = Date.now(); // ~ start of the recorded video
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.body.innerText.includes("Loading orbital catalog"), {
    timeout: 60000,
  });
  await page.waitForTimeout(2500);
  await page.evaluate(CAPTION_JS);

  // Absolute-clock scheduling: every caption and hold is anchored to loopT0 plus
  // the beat's position in the narration timeline, so the picture cannot drift
  // from the voice no matter how long a UI action takes (the action runs inside
  // the beat's settle window). The measured boot offset is trimmed at mux time.
  const loopT0 = Date.now();
  const trimOffsetSec = (loopT0 - recordT0) / 1000;
  const sleepUntil = async (targetSec) => {
    const ms = loopT0 + targetSec * 1000 - Date.now();
    if (ms > 0) await page.waitForTimeout(ms);
  };

  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const narrStart = acc + s.settleMs / 1000;
    const beatEnd = acc + s.totalSec;
    if (s.title) await showTitle(page, true);
    try {
      await s.act(page);
    } catch (e) {
      console.warn(`  beat ${i} action: ${e.message}`);
    }
    await sleepUntil(narrStart); // narration begins exactly here (audio matches)
    if (s.title) await showTitle(page, false);
    await setCaption(page, s.cap);
    await sleepUntil(beatEnd);
    acc = beatEnd;
  }
  await page.waitForTimeout(300);
  const wallDurSec = (Date.now() - recordT0) / 1000; // true real-time length
  await context.close();
  await browser.close();

  const webm = readdirSync(RAW).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("no recording produced");
  const webmPath = resolve(RAW, webm);
  // Playwright stretches the webm timeline when the WebGL page renders below the
  // target FPS, so the recording is longer than real time. Rescale the video PTS
  // back to the measured wall-clock duration so it locks to the audio timeline.
  const webmDurSec = durationSec(webmPath);
  const rate = wallDurSec / webmDurSec; // < 1 compresses the stretched video
  console.log(`recording: webm ${webmDurSec.toFixed(1)}s -> wall ${wallDurSec.toFixed(1)}s (rate ${rate.toFixed(4)})`);

  console.log("Building narration track...");
  const listFile = resolve(RAW, "list.txt");
  writeFileSync(listFile, segs.map((s) => `file '${s.full.replace(/\\/g, "/")}'`).join("\n"));
  const narration = resolve(RAW, "narration.m4a");
  ff(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "aac", "-b:a", "160k", narration]);

  console.log(`Muxing final video... (rescale ${rate.toFixed(4)}, trim ${trimOffsetSec.toFixed(2)}s boot)`);
  const finalOut = resolve(OUT, "APSIS-demo.mp4");
  // Rescale the video to real time, drop the boot pre-roll, then mux the audio.
  const vfilter = `[0:v]setpts=PTS*${rate.toFixed(6)},trim=start=${trimOffsetSec.toFixed(3)},setpts=PTS-STARTPTS[v]`;
  ff([
    "-y",
    "-i",
    webmPath,
    "-i",
    narration,
    "-filter_complex",
    vfilter,
    "-map",
    "[v]",
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

  console.log(`\nDONE -> ${finalOut}  (~${durationSec(finalOut).toFixed(1)}s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
