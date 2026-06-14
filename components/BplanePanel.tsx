"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/store";
import { getClientObject, clientCatalogReady } from "../app/clientCatalog";
import { analyzeConjunction, pcOverTime, type PcSample } from "../lib/conjunction/encounter";
import { covarianceEllipse } from "../lib/conjunction/probability";
import { fmtPc, fmtKm } from "../lib/format";

interface Analysis {
  major: number; // 1-sigma semi-axis, km
  minor: number;
  angleRad: number;
  missX: number; // km, encounter-plane coords
  missY: number;
  hbrKm: number;
  pc: number;
  series: PcSample[];
}

export default function BplanePanel() {
  const conjunctions = useApp((s) => s.conjunctions);
  const idx = useApp((s) => s.selectedConjunctionIndex);
  const c = conjunctions[idx];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  // Recompute the encounter geometry whenever the selected conjunction changes.
  useEffect(() => {
    if (!c) {
      setAnalysis(null);
      return;
    }
    let cancelled = false;
    let tries = 0;
    const attempt = () => {
      if (cancelled) return;
      if (!clientCatalogReady() && tries < 40) {
        tries++;
        setTimeout(attempt, 150);
        return;
      }
      const primary = getClientObject(c.primaryId);
      const secondary = getClientObject(c.secondaryId);
      if (!primary || !secondary) return;
      const a = analyzeConjunction(primary, secondary, c.tcaMs);
      if (!a) return;
      const ell = covarianceEllipse(a.c2);
      const series = pcOverTime(primary, secondary, c.tcaMs, 600, 61);
      if (cancelled) return;
      setAnalysis({
        major: ell.major,
        minor: ell.minor,
        angleRad: ell.angleRad,
        missX: a.miss[0],
        missY: a.miss[1],
        hbrKm: a.hbrKm,
        pc: a.pc,
        series,
      });
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, [c?.primaryId, c?.secondaryId, c?.tcaMs]);

  // Draw the encounter-plane figure.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !analysis) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = (cv.width = cv.clientWidth * dpr);
    const H = (cv.height = cv.clientHeight * dpr);
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2;
    const missMag = Math.hypot(analysis.missX, analysis.missY);
    const extent = Math.max(missMag + 3 * analysis.major, 3 * analysis.major) * 1.18 || 1;
    const k = Math.min(W, H) / 2 / extent; // km -> px
    const toPx = (x: number, y: number): [number, number] => [cx + x * k, cy - y * k];

    // grid + axes
    ctx.strokeStyle = "rgba(79,214,255,0.10)";
    ctx.lineWidth = 1;
    for (let g = -3; g <= 3; g++) {
      const r = g * analysis.major;
      const [gx] = toPx(r, 0);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, H);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(126,228,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(W, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, H);
    ctx.stroke();

    // covariance ellipses at the miss point (1 and 3 sigma)
    const [mx, my] = toPx(analysis.missX, analysis.missY);
    for (const [n, alpha] of [
      [3, 0.10],
      [1, 0.22],
    ] as const) {
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(-analysis.angleRad);
      ctx.beginPath();
      ctx.ellipse(0, 0, analysis.major * n * k, analysis.minor * n * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(79,214,255,${alpha})`;
      ctx.fill();
      ctx.strokeStyle = "rgba(126,228,255,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    // hard-body disk at origin (true scale, min 3px so it stays visible)
    const hbPx = Math.max(analysis.hbrKm * k, 3);
    ctx.beginPath();
    ctx.arc(cx, cy, hbPx, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,61,113,0.35)";
    ctx.fill();
    ctx.strokeStyle = "#ff3d71";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // miss vector
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(mx, my);
    ctx.strokeStyle = "rgba(93,255,168,0.8)";
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(mx, my, 3.5 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = "#5dffa8";
    ctx.fill();
  }, [analysis]);

  // Draw the Pc-vs-time sparkline.
  useEffect(() => {
    const cv = sparkRef.current;
    if (!cv || !analysis || analysis.series.length === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = (cv.width = cv.clientWidth * dpr);
    const H = (cv.height = cv.clientHeight * dpr);
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    const s = analysis.series;
    const pcs = s.map((p) => Math.max(p.pc, 1e-30));
    const lo = Math.log10(Math.min(...pcs));
    const hi = Math.log10(Math.max(...pcs.map((p) => Math.max(p, 1e-12))));
    const span = Math.max(hi - lo, 1);
    const x = (i: number) => (i / (s.length - 1)) * W;
    const y = (pc: number) => H - ((Math.log10(Math.max(pc, 1e-30)) - lo) / span) * (H * 0.85) - H * 0.08;

    // TCA marker (center)
    ctx.strokeStyle = "rgba(255,201,77,0.4)";
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();

    ctx.beginPath();
    s.forEach((p, i) => {
      const px = x(i);
      const py = y(p.pc);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = "#4fd6ff";
    ctx.lineWidth = 1.6 * dpr;
    ctx.stroke();
    // peak dot
    const peakI = pcs.indexOf(Math.max(...pcs));
    ctx.beginPath();
    ctx.arc(x(peakI), y(pcs[peakI]), 3 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = "#ff3d71";
    ctx.fill();
  }, [analysis]);

  if (!c) return null;

  return (
    <section className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">Encounter Plane (B-plane)</span>
        {analysis && <span className="readout text-[10px] text-instrument-soft">Pc {fmtPc(analysis.pc)}</span>}
      </div>
      <div className="relative">
        <canvas ref={canvasRef} className="h-[190px] w-full rounded-md bg-vacuum-900/60" />
        <div className="pointer-events-none absolute left-2 top-2 space-y-1">
          <Legend color="#ff3d71" label="combined hard-body" />
          <Legend color="#4fd6ff" label="covariance 1σ / 3σ" />
          <Legend color="#5dffa8" label="miss vector" />
        </div>
      </div>
      {analysis && (
        <div className="readout mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-white/55">
          <span>miss in-plane</span>
          <span className="text-right text-white/85">
            {fmtKm(Math.hypot(analysis.missX, analysis.missY))}
          </span>
          <span>1σ major / minor</span>
          <span className="text-right text-white/85">
            {fmtKm(analysis.major)} / {fmtKm(analysis.minor)}
          </span>
          <span>hard-body radius</span>
          <span className="text-right text-white/85">{(analysis.hbrKm * 1000).toFixed(0)} m</span>
        </div>
      )}
      <div className="eyebrow mt-3 mb-1">Probability through encounter (±10 min)</div>
      <canvas ref={sparkRef} className="h-[52px] w-full rounded-md bg-vacuum-900/60" />
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="readout text-[9px] text-white/60">{label}</span>
    </div>
  );
}
