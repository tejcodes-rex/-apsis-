"use client";

import { useMemo, useState } from "react";
import { useApp } from "../app/store";
import BplanePanel from "./BplanePanel";
import {
  fmtClock,
  fmtDuration,
  fmtKm,
  fmtPc,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  typeLabel,
} from "../lib/format";
import type { Conjunction } from "../lib/astro/types";

export default function Dashboard() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col">
      <Header />
      <div className="flex flex-1 items-stretch justify-between gap-3 overflow-hidden px-3 pb-3">
        <div className="pointer-events-auto flex w-[270px] shrink-0 flex-col gap-3 overflow-y-auto pr-1 xl:w-[310px]">
          <AssetPanel />
          <RiskMeter />
          <FeaturedAlerts />
          <FleetPanel />
          <GlobalScanPanel />
        </div>
        <div className="pointer-events-auto flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto pl-1 xl:w-[360px]">
          <WatchList />
          <ConjunctionDetail />
          <BplanePanel />
          <ManeuverConsole />
        </div>
      </div>
      <TimeBar />
    </div>
  );
}

function Panel({
  title,
  children,
  accent,
}: {
  title: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <section className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow" style={accent ? { color: accent } : undefined}>
          {title}
        </span>
      </div>
      {children}
    </section>
  );
}

function Header() {
  const meta = useApp((s) => s.meta);
  const count = useApp((s) => s.objects?.count ?? 0);
  const simTimeMs = useApp((s) => s.simTimeMs);
  const conjunctions = useApp((s) => s.conjunctions);
  const critical = conjunctions.filter((c) => c.severity === "CRITICAL").length;

  return (
    <header className="pointer-events-auto flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="relative flex h-9 w-9 items-center justify-center">
          <span className="absolute inset-0 rounded-full border border-instrument/40" />
          <span className="absolute inset-0 animate-sweep rounded-full border-t border-instrument" />
          <span className="h-1.5 w-1.5 rounded-full bg-instrument shadow-glow" />
        </div>
        <div>
          <div className="font-mono text-lg font-semibold tracking-[0.3em] text-white">APSIS</div>
          <div className="eyebrow -mt-0.5">Autonomous Space Traffic Management</div>
        </div>
      </div>

      <div className="flex items-center gap-5">
        <Readout label="UTC EPOCH" value={fmtClock(simTimeMs)} />
        <Readout label="TRACKED OBJECTS" value={count.toLocaleString()} />
        <Readout
          label="ACTIVE ALERTS"
          value={String(critical)}
          danger={critical > 0}
        />
        <div className="flex items-center gap-2 rounded-md border border-signal-safe/30 bg-signal-safe/10 px-3 py-1">
          <span className="h-2 w-2 animate-flicker rounded-full bg-signal-safe" />
          <span className="readout text-[11px] text-signal-safe">ENGINE LIVE</span>
        </div>
      </div>

      <div className="hidden text-right lg:block">
        <div className="eyebrow">DATA SOURCE</div>
        <div className="readout text-[11px] text-white/60">{meta?.source ?? "NORAD GP"}</div>
      </div>
    </header>
  );
}

function Readout({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="text-right">
      <div className="eyebrow">{label}</div>
      <div className={`readout text-sm ${danger ? "alert-text" : "text-white"}`}>{value}</div>
    </div>
  );
}

function AssetPanel() {
  const objects = useApp((s) => s.objects);
  const primaryId = useApp((s) => s.primaryId);
  const setPrimary = useApp((s) => s.setPrimary);
  const runScreen = useApp((s) => s.runScreen);
  const screening = useApp((s) => s.screening);
  const [query, setQuery] = useState("");

  const primaryInfo = useMemo(() => {
    if (!objects || primaryId == null) return null;
    for (let i = 0; i < objects.ids.length; i++) {
      if (objects.ids[i] === primaryId)
        return {
          name: objects.names[i],
          type: objects.types[i],
          apogee: objects.apogee[i],
          perigee: objects.perigee[i],
          incl: objects.incl[i],
        };
    }
    return null;
  }, [objects, primaryId]);

  const matches = useMemo(() => {
    if (!objects || query.trim().length < 2) return [];
    const q = query.toUpperCase();
    const out: { id: number; name: string }[] = [];
    for (let i = 0; i < objects.names.length && out.length < 8; i++) {
      if (objects.types[i] === 0 && objects.names[i].toUpperCase().includes(q))
        out.push({ id: objects.ids[i], name: objects.names[i] });
    }
    return out;
  }, [objects, query]);

  return (
    <Panel title="Protected Asset">
      {primaryInfo && (
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <span className="dot" style={{ background: "#5dffa8" }} />
            <span className="readout text-sm text-white">{primaryInfo.name}</span>
          </div>
          <div className="readout mt-2 grid grid-cols-3 gap-2 text-[11px] text-white/60">
            <Stat label="PERIGEE" value={`${primaryInfo.perigee.toFixed(0)} km`} />
            <Stat label="APOGEE" value={`${primaryInfo.apogee.toFixed(0)} km`} />
            <Stat label="INCL" value={`${primaryInfo.incl.toFixed(1)}°`} />
          </div>
          <div className="eyebrow mt-2">{typeLabel(primaryInfo.type)}</div>
        </div>
      )}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search payloads to protect..."
        className="readout w-full rounded-md border border-instrument/20 bg-vacuum-800 px-2 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-instrument/50 focus:outline-none"
      />
      {matches.length > 0 && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-instrument/10 bg-vacuum-900">
          {matches.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setPrimary(m.id);
                setQuery("");
                runScreen();
              }}
              className="readout block w-full px-2 py-1.5 text-left text-[11px] text-white/70 hover:bg-instrument/10 hover:text-white"
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
      <button onClick={runScreen} disabled={screening} className="btn mt-3 w-full">
        {screening ? "Screening catalog..." : "Re-screen Conjunctions"}
      </button>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-white/35">{label}</div>
      <div className="text-white">{value}</div>
    </div>
  );
}

function RiskMeter() {
  const conjunctions = useApp((s) => s.conjunctions);
  const buckets = useMemo(() => {
    const b = { CRITICAL: 0, WARNING: 0, WATCH: 0, INFO: 0 } as Record<string, number>;
    for (const c of conjunctions) b[c.severity]++;
    return b;
  }, [conjunctions]);
  const total = conjunctions.length || 1;

  return (
    <Panel title="Risk Posture · 48h Window">
      <div className="space-y-2">
        {(["CRITICAL", "WARNING", "WATCH", "INFO"] as const).map((sev) => (
          <div key={sev} className="flex items-center gap-2">
            <span className="dot" style={{ background: SEVERITY_COLOR[sev] }} />
            <span className="readout w-20 text-[11px] text-white/70">{SEVERITY_LABEL[sev]}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-vacuum-700">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(buckets[sev] / total) * 100}%`,
                  background: SEVERITY_COLOR[sev],
                }}
              />
            </div>
            <span className="readout w-6 text-right text-[11px] text-white">{buckets[sev]}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FeaturedAlerts() {
  const featured = useApp((s) => s.featured);
  const loadFeatured = useApp((s) => s.loadFeatured);
  const objects = useApp((s) => s.objects);
  if (featured.length === 0) return null;

  const ACTIVE = new Set(["ACTIVE", "STARLINK", "RECENT", "STATION"]);
  const operatorOf = (id: number) => {
    if (!objects) return "UNKNOWN";
    for (let i = 0; i < objects.ids.length; i++) if (objects.ids[i] === id) return objects.operators[i];
    return "UNKNOWN";
  };
  const involvesActive = (e: Conjunction) =>
    ACTIVE.has(operatorOf(e.primaryId)) || ACTIVE.has(operatorOf(e.secondaryId));

  // Surface hypervelocity events first, preferring those that threaten an active
  // satellite (a real protected-asset scenario), then by collision probability.
  const hero = [...featured]
    .filter((e) => e.relativeSpeedKmps > 5)
    .sort((a, b) => {
      const av = involvesActive(a) ? 1 : 0;
      const bv = involvesActive(b) ? 1 : 0;
      if (av !== bv) return bv - av;
      return b.pc - a.pc;
    })
    .slice(0, 6);

  return (
    <Panel title="Predicted High-Energy Events" accent="#ff8a3d">
      <div className="space-y-2">
        {hero.map((e, i) => (
          <button
            key={i}
            data-testid="featured-event"
            onClick={() => loadFeatured(e)}
            className="block w-full rounded-md border border-signal-hazard/20 bg-signal-hazard/5 p-2 text-left transition hover:border-signal-hazard/50 hover:bg-signal-hazard/10"
          >
            <div className="readout flex items-center justify-between text-[11px]">
              <span className="text-white/85">{e.primaryName}</span>
              <span style={{ color: SEVERITY_COLOR[e.severity] }}>{fmtPc(e.pc)}</span>
            </div>
            <div className="readout mt-0.5 text-[10px] text-white/45">
              ✗ {e.secondaryName} · {fmtKm(e.missKm)} · {e.relativeSpeedKmps.toFixed(1)} km/s
            </div>
          </button>
        ))}
      </div>
      <div className="readout mt-2 text-[9px] leading-relaxed text-white/30">
        Precomputed from the bundled catalog by the all-pairs sieve. Click to load as a live
        protected-asset scenario.
      </div>
    </Panel>
  );
}

function WatchList() {
  const conjunctions = useApp((s) => s.conjunctions);
  const selected = useApp((s) => s.selectedConjunctionIndex);
  const select = useApp((s) => s.selectConjunction);
  const screening = useApp((s) => s.screening);
  const simTimeMs = useApp((s) => s.simTimeMs);

  return (
    <Panel title={`Conjunction Watchlist · ${conjunctions.length}`}>
      {screening && <div className="readout text-[11px] text-instrument-soft">Screening...</div>}
      {!screening && conjunctions.length === 0 && (
        <div className="readout text-[11px] text-white/40">
          No close approaches under the screening gate in this window.
        </div>
      )}
      <div className="max-h-[230px] space-y-1 overflow-y-auto">
        {conjunctions.slice(0, 40).map((c, i) => (
          <button
            key={`${c.secondaryId}-${i}`}
            onClick={() => select(i)}
            className={`block w-full rounded-md border px-2 py-1.5 text-left transition ${
              i === selected
                ? "border-instrument/60 bg-instrument/10"
                : "border-transparent hover:border-instrument/20 hover:bg-white/5"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="dot" style={{ background: SEVERITY_COLOR[c.severity] }} />
                <span className="readout text-[11px] text-white/85">{c.secondaryName}</span>
              </div>
              <span className="readout text-[11px]" style={{ color: SEVERITY_COLOR[c.severity] }}>
                {c.fosterValid === false ? "co-orbital" : fmtPc(c.pc)}
              </span>
            </div>
            <div className="readout mt-0.5 pl-4 text-[10px] text-white/40">
              {fmtKm(c.missKm)} miss · {c.relativeSpeedKmps.toFixed(1)} km/s · T
              {(c.tcaMs - simTimeMs >= 0 ? "+" : "") + fmtDuration(c.tcaMs - simTimeMs)}
            </div>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function ConjunctionDetail() {
  const conjunctions = useApp((s) => s.conjunctions);
  const idx = useApp((s) => s.selectedConjunctionIndex);
  const simTimeMs = useApp((s) => s.simTimeMs);
  const setSimTime = useApp((s) => s.setSimTime);
  const setTimeScale = useApp((s) => s.setTimeScale);
  const c = conjunctions[idx];
  if (!c) return null;
  const dt = c.tcaMs - simTimeMs;

  return (
    <Panel title="Conjunction Assessment" accent={SEVERITY_COLOR[c.severity]}>
      <div className="readout mb-2 flex items-center justify-between">
        <span className="text-white/85 text-xs">{c.primaryName}</span>
        <span className="text-white/30">×</span>
        <span className="text-xs" style={{ color: SEVERITY_COLOR[c.severity] }}>
          {c.secondaryName}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Metric
          label="COLLISION PROBABILITY"
          value={c.fosterValid === false ? "N/A" : fmtPc(c.pc)}
          accent={SEVERITY_COLOR[c.severity]}
          big
        />
        <Metric label="MISS DISTANCE" value={fmtKm(c.missKm)} />
        <Metric label="RELATIVE SPEED" value={`${c.relativeSpeedKmps.toFixed(2)} km/s`} />
        <Metric label="TIME TO TCA" value={fmtDuration(dt)} />
        <Metric label="HARD-BODY RADIUS" value={`${(c.hardBodyRadiusKm * 1000).toFixed(0)} m`} />
        <Metric label="ENCOUNTER" value={encounterClass(c.relativeSpeedKmps)} />
      </div>
      {c.fosterValid === false && (
        <div className="readout mt-2 text-[10px] leading-relaxed text-signal-watch/90">
          Co-orbital encounter (relative speed below 0.5 km/s). The Foster 2D model assumes a
          short hypervelocity pass, so a 2D collision probability is not physically meaningful
          here and is withheld.
        </div>
      )}
      <button
        data-testid="jump-tca"
        onClick={() => {
          setSimTime(c.tcaMs - 90 * 1000);
          setTimeScale(8);
        }}
        className="btn mt-3 w-full"
      >
        Jump to Closest Approach
      </button>
    </Panel>
  );
}

function Metric({
  label,
  value,
  accent,
  big,
}: {
  label: string;
  value: string;
  accent?: string;
  big?: boolean;
}) {
  return (
    <div className="rounded-md border border-white/5 bg-vacuum-900/60 p-2">
      <div className="text-white/35 text-[9px] tracking-wider">{label}</div>
      <div
        className={`readout ${big ? "text-base" : "text-sm"}`}
        style={{ color: accent ?? "#fff" }}
      >
        {value}
      </div>
    </div>
  );
}

function ManeuverConsole() {
  const conjunctions = useApp((s) => s.conjunctions);
  const idx = useApp((s) => s.selectedConjunctionIndex);
  const planSelected = useApp((s) => s.planSelected);
  const planning = useApp((s) => s.planning);
  const maneuver = useApp((s) => s.maneuver);
  const c = conjunctions[idx];
  if (!c) return null;

  const actionable = c.fosterValid !== false && c.pc >= 1e-5;

  return (
    <Panel title="Autonomous Response" accent="#7ee4ff">
      {!maneuver && (
        <>
          <div className="readout text-[11px] leading-relaxed text-white/55">
            {c.fosterValid === false
              ? "This is a slow co-orbital encounter, not a hypervelocity collision risk. Avoidance maneuver planning does not apply."
              : actionable
                ? "Collision probability exceeds the response threshold. The planner will compute the minimum-propellant avoidance maneuver."
                : "Probability is below the action threshold. A precautionary maneuver can still be computed for planning."}
          </div>
          <button
            data-testid="plan-maneuver"
            onClick={planSelected}
            disabled={planning || c.fosterValid === false}
            className="btn btn-danger mt-3 w-full"
          >
            {planning ? "Optimizing maneuver..." : "▶ Plan Avoidance Maneuver"}
          </button>
        </>
      )}

      {maneuver && (
        <div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Metric label="Δv MAGNITUDE" value={`${(maneuver.deltaVmagMps * 100).toFixed(1)} cm/s`} accent="#7ee4ff" big />
            <Metric label="BURN LEAD TIME" value={fmtDuration(maneuver.leadTimeSec * 1000)} />
            <Metric label="Pc AFTER" value={fmtPc(maneuver.pcAfter)} accent="#5dffa8" />
            <Metric label="MISS AFTER" value={fmtKm(maneuver.missAfterKm)} accent="#5dffa8" />
            <Metric label="PROPELLANT" value={`${(maneuver.propellantKg * 1000).toFixed(1)} g`} />
            <Metric
              label="Pc REDUCTION"
              value={`${(c.pc / Math.max(maneuver.pcAfter, 1e-30)).toExponential(1)}×`}
              accent="#5dffa8"
            />
          </div>
          <div className="rounded-md border border-instrument/15 bg-vacuum-900/70 p-2">
            <div className="eyebrow mb-1">Decision Rationale</div>
            <div className="readout text-[10px] leading-relaxed text-white/65">
              {maneuver.rationale}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-2 w-2 animate-flicker rounded-full bg-signal-safe" />
            <span className="readout text-[10px] text-signal-safe">
              MANEUVER PLOTTED · cyan arc is a two-body preview of the post-burn track
            </span>
          </div>
          <button onClick={planSelected} className="btn mt-3 w-full">
            Recompute
          </button>
        </div>
      )}
    </Panel>
  );
}

function FleetPanel() {
  const fleetScan = useApp((s) => s.fleetScan);
  const runFleetScan = useApp((s) => s.runFleetScan);
  const setPrimary = useApp((s) => s.setPrimary);
  const runScreen = useApp((s) => s.runScreen);

  const fleets: { label: string; op: string; tags: string[] }[] = [
    { label: "Starlink", op: "STARLINK", tags: ["STARLINK"] },
    { label: "Stations", op: "STATION", tags: ["STATION"] },
    { label: "Recent launches", op: "RECENT", tags: ["RECENT"] },
  ];

  return (
    <Panel title="Fleet Protection" accent="#7ee4ff">
      <div className="readout text-[10px] leading-relaxed text-white/45">
        Screen an entire operator constellation at once and rank each asset by its worst
        conjunction.
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {fleets.map((f) => (
          <button
            key={f.op}
            onClick={() => runFleetScan(f.op, f.tags, 30, 24)}
            disabled={fleetScan.running}
            className="readout rounded border border-instrument/25 bg-instrument/5 px-2 py-1 text-[11px] text-instrument-soft hover:bg-instrument/15 disabled:opacity-40"
          >
            {f.label}
          </button>
        ))}
      </div>
      {fleetScan.running && (
        <div className="mt-2">
          <div className="readout text-[10px] text-white/50">
            Screening {fleetScan.operator} fleet... {(fleetScan.fraction * 100).toFixed(0)}%
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-vacuum-700">
            <div className="h-full bg-instrument" style={{ width: `${fleetScan.fraction * 100}%` }} />
          </div>
        </div>
      )}
      {!fleetScan.running && fleetScan.board.length > 0 && (
        <div className="mt-2">
          <div className="readout mb-1 text-[10px] text-white/45">
            {fleetScan.operator} · {fleetScan.sampled} of {fleetScan.fleetSize} assets screened
          </div>
          <div className="max-h-[150px] space-y-0.5 overflow-y-auto">
            {fleetScan.board.slice(0, 12).map((row) => (
              <button
                key={row.assetId}
                onClick={() => {
                  setPrimary(row.assetId);
                  runScreen();
                }}
                className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left hover:bg-white/5"
              >
                <span className="readout truncate text-[10px] text-white/75">{row.name}</span>
                <span
                  className="readout ml-2 shrink-0 text-[10px]"
                  style={{ color: SEVERITY_COLOR[severityOf(row.worstPc)] }}
                >
                  {fmtPc(row.worstPc)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function severityOf(pc: number): "INFO" | "WATCH" | "WARNING" | "CRITICAL" {
  if (pc >= 1e-4) return "CRITICAL";
  if (pc >= 1e-5) return "WARNING";
  if (pc >= 1e-7) return "WATCH";
  return "INFO";
}

function encounterClass(relSpeedKmps: number): string {
  if (relSpeedKmps >= 7) return "HYPERVELOCITY";
  if (relSpeedKmps >= 0.5) return "MODERATE";
  return "CO-ORBITAL";
}

function GlobalScanPanel() {
  const runGlobalScan = useApp((s) => s.runGlobalScan);
  const scan = useApp((s) => s.globalScan);

  return (
    <Panel title="Full-Catalog Sieve">
      <div className="readout text-[10px] leading-relaxed text-white/45">
        All-pairs spatial-hash screening across the congested 700-900 km debris shell.
      </div>
      <button
        onClick={() => runGlobalScan(650, 950, 6)}
        disabled={scan.running}
        className="btn mt-2 w-full"
      >
        {scan.running ? `${scan.phase} ${(scan.fraction * 100).toFixed(0)}%` : "Run Global Scan"}
      </button>
      {scan.running && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-vacuum-700">
          <div className="h-full bg-instrument" style={{ width: `${scan.fraction * 100}%` }} />
        </div>
      )}
      {scan.results.length > 0 && (
        <div className="readout mt-2 text-[10px] text-white/60">
          {scan.results.length} conjunctions ·{" "}
          <span style={{ color: SEVERITY_COLOR[scan.results[0].severity] }}>
            worst {fmtPc(scan.results[0].pc)}
          </span>
        </div>
      )}
    </Panel>
  );
}

function TimeBar() {
  const playing = useApp((s) => s.playing);
  const setPlaying = useApp((s) => s.setPlaying);
  const timeScale = useApp((s) => s.timeScale);
  const setTimeScale = useApp((s) => s.setTimeScale);
  const setSimTime = useApp((s) => s.setSimTime);
  const baseTimeMs = useApp((s) => s.baseTimeMs);

  const scales = [1, 10, 60, 300, 1800];

  return (
    <div className="pointer-events-auto mx-3 mb-3 flex items-center gap-4 panel px-4 py-2">
      <button onClick={() => setPlaying(!playing)} className="btn !px-3 !py-1.5">
        {playing ? "❚❚ Pause" : "▶ Play"}
      </button>
      <button onClick={() => setSimTime(baseTimeMs)} className="btn !px-3 !py-1.5">
        ⟲ Now
      </button>
      <div className="flex items-center gap-2">
        <span className="eyebrow">TIME SCALE</span>
        {scales.map((s) => (
          <button
            key={s}
            onClick={() => setTimeScale(s)}
            className={`readout rounded px-2 py-1 text-[11px] ${
              timeScale === s
                ? "bg-instrument/20 text-instrument-soft"
                : "text-white/40 hover:text-white"
            }`}
          >
            {s >= 60 ? `${s / 60}m/s` : `${s}×`}
          </button>
        ))}
      </div>
      <div className="readout ml-auto text-[11px] text-white/40">
        Drag the globe to orbit · scroll to zoom
      </div>
    </div>
  );
}
